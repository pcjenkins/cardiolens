// Pure-function tests: no database needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSchema, parse, validate } from "graphql";
import { cardiacIndex, do2i, oxygenContent, venousSaturation, vo2iAtTemp, bsaMosteller } from "../src/seed/physiology.ts";
import { planSeries, SeriesRangeError } from "../src/series.ts";
import { depthLimit } from "../src/depth-limit.ts";
import { simulateCase, detectAlarms, type Stream } from "../src/seed/simulate.ts";
import { CHANNEL_BY_CODE } from "../src/seed/channels.ts";
import { camel, likeEscape } from "../src/util.ts";

test("oxygen content and DO2i follow the textbook formulas", () => {
  // Hb 10, SaO2 100%, PaO2 200: 1.34 * 10 + 0.6 = 14.0 mL/dL
  assert.equal(Math.round(oxygenContent(10, 100, 200) * 100) / 100, 14);
  // flow 4.8 L/min over BSA 2.0 -> CI 2.4; DO2i = 2.4 * 14 * 10 = 336
  assert.equal(Math.round(do2i(cardiacIndex(4.8, 2.0), 14)), 336);
  assert.equal(cardiacIndex(5, 0), 0);
});

test("cooling lowers oxygen demand and venous saturation responds to delivery", () => {
  assert.ok(vo2iAtTemp(32) < vo2iAtTemp(37));
  assert.equal(Math.round(vo2iAtTemp(37)), 110);
  const good = venousSaturation(100, 400, 100), poor = venousSaturation(100, 200, 100);
  assert.ok(good > poor);
  assert.equal(venousSaturation(100, 100, 200), 40);       // extraction capped at 60%
  assert.equal(Math.round(bsaMosteller(180, 80) * 100) / 100, 2);
});

test("series planner: raw when it fits, aggregates when it doesn't", () => {
  assert.deepEqual(planSeries(600, 1500), { resolution: "RAW", source: "raw", stepSeconds: 1 });
  assert.deepEqual(planSeries(7200, 1500), { resolution: "MINUTE", source: "agg_minute", stepSeconds: 60 });
  assert.deepEqual(planSeries(7 * 86400, 1000), { resolution: "MINUTE", source: "agg_minute", stepSeconds: 660 });
  assert.equal(planSeries(90 * 86400, 100).source, "agg_hour");
  assert.equal(planSeries(5 * 365 * 86400, 100).source, "agg_day");
  assert.deepEqual(planSeries(7200, 1500, "HOUR"), { resolution: "HOUR", source: "agg_hour", stepSeconds: 3600 });
});

test("series planner refuses an oversized RAW request instead of truncating it", () => {
  assert.throws(() => planSeries(7200, 1500, "RAW"), SeriesRangeError);
  assert.throws(() => planSeries(0, 1500), SeriesRangeError);
  assert.throws(() => planSeries(600, 5), SeriesRangeError);
});

test("depth limit counts through fragments and rejects deep queries", () => {
  const schema = buildSchema(`type Query { a: A } type A { b: A, x: Int }`);
  const ok = parse(`{ a { b { b { x } } } }`);
  const deep = parse(`query { a { ...F } } fragment F on A { b { b { b { b { x } } } } }`);
  assert.equal(validate(schema, ok, [depthLimit(4)]).length, 0);
  const errors = validate(schema, deep, [depthLimit(4)]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /depth 6 exceeds the limit of 4/);
});

const MIN = 60_000;
const t0 = Date.UTC(2026, 0, 5, 13);
const timeline = {
  inRoom: t0, incision: t0 + 40 * MIN, heparin: t0 + 90 * MIN, cpbOn: t0 + 100 * MIN, xclampOn: t0 + 106 * MIN,
  xclampOff: t0 + 170 * MIN, rewarmStart: t0 + 150 * MIN, cpbOff: t0 + 195 * MIN, protamine: t0 + 205 * MIN, outRoom: t0 + 260 * MIN,
};
const spec = { seed: 11, bsa: 1.9, timeline, lowestTempC: 32, targetCI: 2.4, proactive: true, hbBaseline: 13, hypotensionRate: 1, hotRewarm: false };

test("simulation is deterministic and stays inside its sessions", () => {
  const a = simulateCase(spec), b = simulateCase(spec);
  assert.deepEqual(a.workstation.stream.value.slice(0, 500), b.workstation.stream.value.slice(0, 500));
  assert.equal(a.alarms.length, b.alarms.length);
  const ws = a.workstation;
  assert.ok(ws.stream.ts.every((t) => t >= ws.start && t < ws.end));
  assert.ok(a.monitor.stream.ts.every((t) => t >= a.monitor.start && t < a.monitor.end));
  // 18 workstation channels every second for (bypass + 10 min)
  assert.equal(ws.stream.ts.length, ((ws.end - ws.start) / 1000) * 18);
});

test("off pump, circuit-only channels are flagged sensor_off, not recorded as zeros", () => {
  const { stream } = simulateCase(spec).workstation;
  const do2 = CHANNEL_BY_CODE.DO2I.id;
  const before = stream.ts.map((t, i) => i).filter((i) => stream.channel[i] === do2 && stream.ts[i] < timeline.cpbOn);
  assert.ok(before.length > 0);
  assert.ok(before.every((i) => stream.quality[i] === 2));
});

test("alarm detection needs the hold time and re-arms only after recovery", () => {
  const id = CHANNEL_BY_CODE.MAP.id;
  const values = [60, ...Array(12).fill(45), ...Array(5).fill(60), ...Array(12).fill(45), ...Array(40).fill(60), ...Array(12).fill(45)];
  const s: Stream = { channel: values.map(() => id), ts: values.map((_, i) => i * 1000), value: values, quality: values.map(() => 0) };
  const alarms = detectAlarms(s, "MAP", "low", 50, 10, "monitor", { int: () => 5 });
  // first run alarms; second run is within 30 s of recovery so stays silent; third (after 40 s ok) alarms again
  assert.equal(alarms.length, 2);
  assert.equal(alarms[0].ts, 10_000);
});

test("helpers: camelCase rows and LIKE escaping", () => {
  assert.deepEqual(camel({ case_id: 1, do2i_nadir: 2, p50: 3 }), { caseId: 1, do2iNadir: 2, p50: 3 });
  assert.equal(likeEscape("50%_a\\b"), "50\\%\\_a\\\\b");
});
