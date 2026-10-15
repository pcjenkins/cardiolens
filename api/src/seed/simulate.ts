// Simulates one cardiac surgery case second by second: the perfusion workstation's channels while the
// patient is on the circuit, and the patient monitor's channels for the whole time in the room.
// Pure: same spec + same seed => same output. No database access.

import { CHANNEL_BY_CODE, QUALITY } from "./channels.ts";
import { cardiacIndex, do2i, oxygenContent, venousSaturation, vo2iAtTemp } from "./physiology.ts";
import { createRng } from "./random.ts";

const S = 1000; // ms per second
const MIN = 60 * S;

export type Timeline = {
  inRoom: number; incision: number; heparin: number; cpbOn: number; xclampOn: number;
  xclampOff: number; rewarmStart: number; cpbOff: number; protamine: number; outRoom: number;
};

export type CaseSpec = {
  seed: number;
  bsa: number;
  timeline: Timeline;
  lowestTempC: number;
  targetCI: number;            // the perfusionist's flow target
  proactive: boolean;          // raises flow and sweep when demand rises on rewarming; transfuses earlier
  hbBaseline: number;          // pre-op hemoglobin
  hypotensionRate: number;     // expected hypotensive episodes on bypass
  hotRewarm: boolean;          // lets arterial outlet temperature overshoot 37 °C
};

export type Stream = { channel: number[]; ts: number[]; value: number[]; quality: number[] };
export type SimAlarm = { source: "workstation" | "monitor"; channel: string; ts: number; limitKind: "low" | "high"; limitValue: number; value: number; ackDelayS: number };
export type SimResult = {
  workstation: { start: number; end: number; stream: Stream };
  monitor: { start: number; end: number; stream: Stream };
  alarms: SimAlarm[];
  settings: { ts: number; parameter: string; oldValue: number | null; newValue: number }[];
  emboli: { ts: number; line: "arterial" | "venous" | "cardioplegia"; volumeNl: number }[];
  labs: { ts: number; test: string; value: number; unit: string }[];
  transfusions: { ts: number; product: "PRBC"; units: number }[];
  cardioplegia: { ts: number; doseMl: number }[];
};

type Window = { start: number; end: number; depth?: number };
const inside = (t: number, ws: Window[]) => ws.find((w) => t >= w.start && t < w.end);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ramp = (t: number, w: Window) => {
  // 0..1..0 envelope with 10-second edges, for dips that ease in and out
  const edge = 10 * S;
  return Math.min(1, (t - w.start) / edge, (w.end - t) / edge);
};

export function simulateCase(spec: CaseSpec): SimResult {
  const rng = createRng(spec.seed);
  const T = spec.timeline;
  const wsStart = T.cpbOn - 5 * MIN, wsEnd = T.cpbOff + 5 * MIN;
  const monStart = T.inRoom + 8 * MIN, monEnd = T.outRoom - 8 * MIN;

  // ---- windows for the things that happen during a case ----
  const windowsDuring = (from: number, to: number, count: number, minS: number, maxS: number, depth?: () => number): Window[] =>
    Array.from({ length: count }, () => {
      const len = rng.int(minS, maxS) * S;
      const start = from + Math.floor(rng.next() * Math.max(1, to - from - len));
      return { start, end: start + len, depth: depth?.() };
    });

  const hypotension = windowsDuring(T.cpbOn + 5 * MIN, T.cpbOff - 5 * MIN, rng.poisson(spec.hypotensionRate), 20, 150, () => rng.normal(43, 3));
  if (rng.chance(0.6)) hypotension.push({ start: T.cpbOn + 20 * S, end: T.cpbOn + rng.int(40, 80) * S, depth: rng.normal(46, 3) }); // initiation dip
  const flushes = windowsDuring(T.cpbOn + 2 * MIN, T.cpbOff - 2 * MIN, rng.int(1, 3), 5, 12);
  const svo2Artifacts = windowsDuring(T.cpbOn, T.cpbOff, rng.poisson(1.2), 4, 20);
  const lowLevel = windowsDuring(T.cpbOn + 5 * MIN, T.cpbOff - 5 * MIN, rng.poisson(0.5), 3, 15);
  const clampDips: Window[] = [T.xclampOn, T.xclampOff].map((t) => ({ start: t - 15 * S, end: t + rng.int(15, 40) * S }));

  // ---- settings the perfusionist changes ----
  const settings: SimResult["settings"] = [];
  let fio2 = 60;
  let sweepRatio = 0.8;                         // sweep / flow
  let ciTarget = spec.targetCI;
  const changeAt = new Map<number, () => void>();
  const setting = (ts: number, parameter: string, oldValue: number | null, newValue: number, apply: () => void) =>
    changeAt.set(Math.round(ts / S) * S, () => { settings.push({ ts, parameter, oldValue, newValue }); apply(); });
  setting(T.cpbOn, "FiO2", null, 60, () => (fio2 = 60));
  setting(T.cpbOn, "Sweep ratio", null, 0.8, () => (sweepRatio = 0.8));
  setting(T.cpbOn, "Flow target CI", null, spec.targetCI, () => (ciTarget = spec.targetCI));
  if (!spec.proactive) setting(T.cpbOn + 20 * MIN, "FiO2", 60, 50, () => (fio2 = 50));
  setting(T.cpbOn + 12 * MIN, "Sweep ratio", 0.8, 0.6, () => (sweepRatio = 0.6)); // less CO2 production when cold
  const rewarmReact = spec.proactive ? T.rewarmStart : T.rewarmStart + 12 * MIN;
  setting(rewarmReact, "Sweep ratio", 0.6, 1.0, () => (sweepRatio = 1.0));
  if (spec.proactive) setting(T.rewarmStart, "Flow target CI", spec.targetCI, +(spec.targetCI + 0.3).toFixed(2), () => (ciTarget = spec.targetCI + 0.3));

  // ---- cardioplegia doses and emboli ----
  const cardioplegia = cardioplegiaSchedule(T);

  const emboli: SimResult["emboli"] = [];
  const addEmbolus = (t: number, line: "arterial" | "venous" | "cardioplegia") =>
    emboli.push({ ts: t + rng.int(0, 999), line, volumeNl: Math.round(Math.exp(rng.normal(3.4, 1)) * 10) / 10 });
  for (let i = 0; i < rng.int(8, 20); i++) addEmbolus(T.cpbOn + rng.int(0, 120) * S, rng.chance(0.5) ? "venous" : "arterial");
  for (const d of cardioplegia) for (let i = 0; i < rng.int(1, 4); i++) addEmbolus(d.ts + rng.int(0, 60) * S, "cardioplegia");
  for (let t = T.cpbOn + 2 * MIN; t < T.cpbOff; t += S) if (rng.chance(0.012)) addEmbolus(t, rng.chance(0.6) ? "venous" : "arterial");
  // unique (ts, line)
  const seen = new Set<string>();
  const uniqueEmboli = emboli.filter((e) => { const k = `${e.ts}|${e.line}`; if (seen.has(k)) return false; seen.add(k); return true; });

  // ---- state ----
  let tNaso = 36.3;
  let hbFactor = rng.normal(0.72, 0.03);        // hemodilution from the circuit prime
  let hbBoost = 0;                              // from transfusions
  let lastTransfusion = -Infinity;
  const transfusions: SimResult["transfusions"] = [];
  let mapWalk = 0;
  const mapOnPump = rng.normal(66, 4);
  let do2Deficit = 0;                           // seconds of DO2i < 280, drives lactate
  const ws: Stream = { channel: [], ts: [], value: [], quality: [] };
  const mon: Stream = { channel: [], ts: [], value: [], quality: [] };
  const push = (s: Stream, code: string, ts: number, value: number, quality: number = QUALITY.valid) => {
    const c = CHANNEL_BY_CODE[code];
    const f = 10 ** (c.decimals + 1);                     // store at one decimal finer than displayed
    s.channel.push(c.id); s.ts.push(ts); s.value.push(Math.round(value * f) / f); s.quality.push(quality);
  };
  const snapshots = new Map<number, { pao2: number; paco2: number; hct: number; do2i: number }>();

  for (let t = monStart; t < monEnd; t += S) {
    changeAt.get(t)?.();
    const onPump = t >= T.cpbOn && t < T.cpbOff;
    const clamped = t >= T.xclampOn && t < T.xclampOff;
    const rewarming = t >= T.rewarmStart && t < T.cpbOff;

    // temperature
    if (t < T.cpbOn) tNaso += (35.9 - tNaso) / 3600;
    else if (onPump && !rewarming) tNaso += (spec.lowestTempC - tNaso) / 480;
    else if (rewarming) tNaso = Math.min(36.8, tNaso + 0.4 / 60);           // ≤ 0.4 °C/min
    else tNaso += (36.2 - tNaso) / 2400;
    const tArtTarget = !onPump ? 35 : rewarming ? Math.min(tNaso + 2.2, spec.hotRewarm ? 37.6 : 36.9) : tNaso - (t < T.cpbOn + 15 * MIN ? 1.5 : 0.3);

    // flow
    const flowFull = ciTarget * spec.bsa;
    let flow = 0;
    if (onPump) {
      if (t < T.cpbOn + 60 * S) flow = flowFull * (t - T.cpbOn) / (60 * S);
      else if (t > T.cpbOff - 120 * S) flow = flowFull * (T.cpbOff - t) / (120 * S);
      else flow = flowFull * (1 + rng.normal(0, 0.015));
      const dip = inside(t, clampDips);
      if (dip) flow *= 1 - 0.5 * ramp(t, dip);
    }
    flow = Math.max(0, flow);

    // hemoglobin and transfusion trigger
    const trigger = spec.proactive ? 7.5 : 7.0;
    const hb = spec.hbBaseline * hbFactor + hbBoost;
    if (onPump && t > T.cpbOn + 10 * MIN && hb < trigger && t - lastTransfusion > 30 * MIN) {
      transfusions.push({ ts: t, product: "PRBC", units: 1 });
      lastTransfusion = t;
    }
    if (t - lastTransfusion < 5 * MIN) hbBoost += 0.9 / 300;               // a unit mixes in over ~5 minutes
    if (onPump) hbFactor -= 0.00000045;                                     // slow dilution from cardioplegia/fluids

    // gases and oxygen delivery
    const sao2 = clamp(rng.normal(fio2 < 40 ? 97 : 99.6, 0.2), 90, 100);
    const pao2 = clamp(35 + fio2 * 3.9 + rng.normal(0, 6), 60, 450);
    const vo2Demand = vo2iAtTemp(tNaso);
    const sweep = flow * sweepRatio;
    // CO2 removal: the sweep that would hold PaCO2 at 40 scales with metabolic demand; a lagging sweep lets it drift.
    const idealRatio = 0.8 * vo2Demand / vo2iAtTemp(36);
    const paco2 = flow > 0.3 ? clamp(40 * idealRatio / Math.max(0.2, sweepRatio) + rng.normal(0, 1), 20, 70) : 0;
    const ci = cardiacIndex(flow, spec.bsa);
    const cao2 = oxygenContent(hb, sao2, pao2);
    const deliv = do2i(ci, cao2);
    const svo2 = venousSaturation(sao2, deliv, vo2Demand) + rng.normal(0, 0.5);
    const cvo2 = oxygenContent(hb, svo2, 40);
    const vo2 = ci * (cao2 - cvo2) * 10;
    if (onPump && deliv < 280) do2Deficit++;

    // pressures
    mapWalk = mapWalk * 0.995 + rng.normal(0, 0.35);
    let map = onPump ? mapOnPump + mapWalk : 76 + mapWalk;
    const hypo = onPump ? inside(t, hypotension) : undefined;
    if (hypo) map = map + (hypo.depth! - map) * ramp(t, hypo);
    map += rng.normal(0, 1.2);

    // ---- workstation channels ----
    if (t >= wsStart && t < wsEnd) {
      const circulating = flow > 0.3;
      const flush = inside(t, flushes);
      push(ws, "ART_P", t, flush ? rng.normal(360, 10) : circulating ? 50 + flow * 30 + map * 0.8 + rng.normal(0, 3) : rng.normal(2, 1), flush ? QUALITY.line_flush : QUALITY.valid);
      push(ws, "VEN_P", t, circulating ? -(25 + flow * 4) + rng.normal(0, 2) : rng.normal(0, 0.5));
      push(ws, "FLOW_ART", t, flow);
      push(ws, "PUMP_RPM", t, flow > 0 ? 1100 + flow * 420 + rng.normal(0, 8) : 0);
      push(ws, "RES_LVL", t, inside(t, lowLevel) ? 0 : 1);
      push(ws, "T_ART", t, tArtTarget + rng.normal(0, 0.05));
      push(ws, "T_VEN", t, (onPump ? tNaso - 0.3 : 35.2) + rng.normal(0, 0.05));
      const q = circulating ? QUALITY.valid : QUALITY.sensor_off;
      const art = inside(t, svo2Artifacts);
      push(ws, "SAO2", t, circulating ? sao2 : 0, q);
      push(ws, "SVO2", t, circulating ? (art ? svo2 + rng.normal(0, 15) : svo2) : 0, art && circulating ? QUALITY.artifact : q);
      push(ws, "HB", t, circulating ? hb + rng.normal(0, 0.05) : 0, q);
      push(ws, "HCT", t, circulating ? hb * 2.94 + rng.normal(0, 0.2) : 0, q);
      push(ws, "FIO2", t, fio2);
      push(ws, "SWEEP", t, sweep);
      push(ws, "PAO2", t, circulating ? pao2 : 0, q);
      push(ws, "PACO2", t, circulating ? paco2 : 0, q);
      push(ws, "CI", t, ci, circulating ? QUALITY.valid : QUALITY.sensor_off);
      push(ws, "DO2I", t, circulating ? deliv : 0, q);
      push(ws, "VO2I", t, circulating ? vo2 : 0, q);
    }

    // ---- monitor channels ----
    const hr = clamped ? 0 : onPump ? (t > T.xclampOff ? 90 : 55) + rng.normal(0, 2) : 74 + rng.normal(0, 3);
    push(mon, "MAP", t, map);
    push(mon, "CVP", t, (onPump ? 2 : t < T.cpbOn ? 9 : 10) + rng.normal(0, 0.8));
    push(mon, "HR", t, Math.max(0, hr));
    push(mon, "T_NASO", t, tNaso + rng.normal(0, 0.03));

    if (onPump && (t - T.cpbOn) % (30 * MIN) === 10 * MIN) snapshots.set(t, { pao2, paco2, hct: hb * 2.94, do2i: do2Deficit });
  }

  // ---- labs: point-of-care draws ----
  const labs: SimResult["labs"] = [];
  const lab = (ts: number, test: string, value: number, unit: string) => labs.push({ ts, test, value: Math.round(value * 100) / 100, unit });
  lab(T.heparin + 5 * MIN, "ACT", rng.normal(520, 50), "s");
  for (const [ts, s] of snapshots) {
    lab(ts, "ACT", rng.normal(490, 60), "s");
    lab(ts, "pH", rng.normal(7.4 - s.do2i / 40000, 0.03), "");
    lab(ts, "PaO2", s.pao2 + rng.normal(0, 10), "mmHg");
    lab(ts, "PaCO2", s.paco2 + rng.normal(0, 2), "mmHg");
    lab(ts, "Lactate", 1.1 + s.do2i / 1500 + Math.abs(rng.normal(0, 0.2)), "mmol/L");
    lab(ts, "Hct", s.hct + rng.normal(0, 1), "%");
    lab(ts, "K", rng.normal(4.3 + (ts > T.xclampOn ? 0.4 : 0), 0.3), "mmol/L");
  }
  lab(T.protamine + 5 * MIN, "ACT", rng.normal(125, 12), "s");

  // ---- alarms, detected from the streams like the device would ----
  const alarms: SimAlarm[] = [
    ...detectAlarms(mon, "MAP", "low", 50, 10, "monitor", rng),
    ...detectAlarms(ws, "SVO2", "low", 60, 15, "workstation", rng),
    ...detectAlarms(ws, "RES_LVL", "low", 0.5, 1, "workstation", rng),
    ...detectAlarms(ws, "T_ART", "high", 37.2, 20, "workstation", rng),
  ];

  return {
    workstation: { start: wsStart, end: wsEnd, stream: ws },
    monitor: { start: monStart, end: monEnd, stream: mon },
    alarms, settings, emboli: uniqueEmboli, labs, transfusions, cardioplegia,
  };
}

/** Antegrade cardioplegia: an induction dose a minute after cross-clamp, then every 20 minutes. */
export function cardioplegiaSchedule(T: Timeline): { ts: number; doseMl: number }[] {
  const out: { ts: number; doseMl: number }[] = [];
  for (let t = T.xclampOn + MIN, i = 0; t < T.xclampOff - 5 * MIN; t += 20 * MIN, i++) out.push({ ts: t, doseMl: i === 0 ? 1000 : 500 });
  return out;
}

/** Fires when a valid signal stays past the limit for holdS seconds; re-arms after 30 s back in range. */
export function detectAlarms(
  s: Stream, code: string, kind: "low" | "high", limit: number, holdS: number,
  source: SimAlarm["source"], rng: { int(a: number, b: number): number },
): SimAlarm[] {
  const id = CHANNEL_BY_CODE[code].id;
  const out: SimAlarm[] = [];
  let run = 0, ok = 30, armed = true;
  for (let i = 0; i < s.channel.length; i++) {
    if (s.channel[i] !== id) continue;
    const valid = s.quality[i] === QUALITY.valid;
    const past = valid && (kind === "low" ? s.value[i] < limit : s.value[i] > limit);
    if (past) { run++; ok = 0; } else { run = 0; if (valid) ok++; }
    if (!armed && ok >= 30) armed = true;
    if (armed && run >= holdS) {
      out.push({ source, channel: code, ts: s.ts[i], limitKind: kind, limitValue: limit, value: s.value[i], ackDelayS: rng.int(3, 25) });
      armed = false;
    }
  }
  return out;
}
