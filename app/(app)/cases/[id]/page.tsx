import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";
import { PHASE_LABEL, clock, duration, num, parseChannels } from "@/lib/format";
import type { CaseQuality, Channel, PhaseWindow, Series } from "@/lib/types";
import PerfusionChart from "@/components/PerfusionChart";
import SeriesControls from "@/components/SeriesControls";

const DEFAULT_CHANNELS = ["DO2I", "MAP", "SVO2", "FLOW_ART", "T_NASO"];

type Episode = { start: string; end: string; seconds: number; extreme: number };
type Detail = {
  case: null | {
    id: string; caseDate: string; procedure: string; source: string; facility: string; room: string; locationPath: string;
    surgeon: { name: string } | null; perfusionist: { name: string } | null;
    patient: { mrn: string; age: number; sex: string; bsaM2: number };
    bypassMin: number | null; crossClampMin: number | null; lowestTempC: number | null; bloodUnits: number; losDays: number | null; outcome: string | null;
    events: { ts: string; type: string; detail: Record<string, unknown> }[];
    phaseWindows: PhaseWindow[];
    quality: CaseQuality | null;
    series: Series;
    phases: { phase: string; channel: { code: string; unit: string; decimals: number }; avg: number | null; min: number | null; p50: number | null; max: number | null; secondsBelow: number; secondsAbove: number }[];
    do2i: Episode[]; map: Episode[];
    sessions: { device: { id: string; assetTag: string; model: string }; startedAt: string; endedAt: string; softwareVersion: string; clockOffsetMs: number; gateway: string; maintenanceOk: boolean | null; maintenanceNote: string | null }[];
    alarms: { ts: string; channel: { code: string }; limitKind: string; limitValue: number; value: number; ackSeconds: number | null }[];
    labs: { ts: string; test: string; value: number; unit: string }[];
    settingChanges: { ts: string; parameter: string; oldValue: number | null; newValue: number }[];
    emboli: { count: number; totalVolumeNl: number; byLine: { line: string; count: number; volumeNl: number }[] };
    disposables: { product: string; kind: string; lot: string; expiresOn: string }[];
  };
};

const QUERY = `query CaseDetail($id: ID!, $channels: [String!]!, $from: DateTime, $to: DateTime) {
  case(id: $id) {
    id caseDate procedure source facility room locationPath
    surgeon { name } perfusionist { name }
    patient { mrn age sex bsaM2 }
    bypassMin crossClampMin lowestTempC bloodUnits losDays outcome
    events { ts type detail }
    phaseWindows { phase start end }
    quality { do2iNadir pctTimeDo2iBelowTarget secondsDo2iBelowTarget svo2Nadir secondsMapBelow50 maxArterialTemp secondsArterialAbove37 hctNadir emboliCount alarmCount artifactPct }
    series(channels: $channels, from: $from, to: $to, maxPoints: 1500) {
      resolution stepSeconds from to
      channels { channel { id code name unit kind formula lowLimit highLimit decimals } points { t avg min max } }
    }
    phases(channels: $channels) { phase channel { code unit decimals } avg min p50 max secondsBelow secondsAbove }
    do2i: episodes(channel: "DO2I") { start end seconds extreme }
    map: episodes(channel: "MAP") { start end seconds extreme }
    sessions { device { id assetTag model } startedAt endedAt softwareVersion clockOffsetMs gateway maintenanceOk maintenanceNote }
    alarms { ts channel { code } limitKind limitValue value ackSeconds }
    labs { ts test value unit }
    settingChanges { ts parameter oldValue newValue }
    emboli { count totalVolumeNl byLine { line count volumeNl } }
    disposables { product kind lot expiresOn }
  }
}`;

const isoOrNull = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export default async function CaseDetail({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ ch?: string; from?: string; to?: string }>;
}) {
  await verifySession();
  const { id } = await params;                         // dynamic segment from the folder name [id]
  if (!/^\d{1,9}$/.test(id)) notFound();
  const sp = await searchParams;

  const { channels } = await gql<{ channels: Channel[] }>(`{ channels { id code name unit kind formula lowLimit highLimit decimals } }`);
  const selected = parseChannels(sp.ch, channels.map((c) => c.code), DEFAULT_CHANNELS);
  const { case: c } = await gql<Detail>(QUERY, { id, channels: selected, from: isoOrNull(sp.from), to: isoOrNull(sp.to) });
  if (!c) notFound();

  const captured = c.source === "live_capture";
  const q = c.quality;
  const recording = c.sessions.length
    ? { from: c.sessions.map((s) => s.startedAt).sort()[0], to: c.sessions.map((s) => s.endedAt).sort().at(-1)! }
    : null;
  const phaseOrder = ["PRE_CPB", "CPB", "FULL_FLOW", "CROSS_CLAMP", "REWARM", "POST_CPB"];
  const phaseRows = selected.map((code) => ({
    code, byPhase: Object.fromEntries(c.phases.filter((p) => p.channel.code === code).map((p) => [p.phase, p])),
  }));

  return (
    <>
      <p><Link href="/cases">← All cases</Link></p>

      <section className="card">
        <div className="toolbar">
          <div style={{ flex: 1 }}>
            <h1>Case #{c.id} · {c.procedure}</h1>
            <p className="muted">{c.caseDate} · {c.facility} · {c.locationPath} / {c.room}</p>
          </div>
          <span className={`badge ${captured ? "ok" : "muted-badge"}`}>{captured ? "Per-second capture" : "Legacy import"}</span>
          {captured && <Link className="button-link" href={`/cases/${c.id}/record`}>Full record</Link>}
          {captured && <a className="button-link" href={`/cases/${c.id}/report`}>Report JSON</a>}
        </div>
        <dl className="detail cols">
          <dt>Patient</dt><dd>MRN {c.patient.mrn} · {c.patient.age} y · {c.patient.sex} · BSA {c.patient.bsaM2} m²</dd>
          <dt>Team</dt><dd>{c.surgeon?.name} (surgeon) · {c.perfusionist?.name} (perfusion)</dd>
          <dt>Bypass / clamp</dt><dd>{c.bypassMin} min / {c.crossClampMin} min</dd>
          <dt>Lowest temperature</dt><dd>{num(c.lowestTempC, 1, "°C")}</dd>
          <dt>Blood products</dt><dd>{c.bloodUnits} units</dd>
          <dt>Length of stay</dt><dd>{c.losDays} days · {c.outcome}</dd>
        </dl>
      </section>

      {!captured && (
        <section className="card">
          <h2>No device data for this case</h2>
          <p className="muted">This case was migrated from the legacy perfusion record system as a case-level summary only.
            Per-second capture starts with the newer cases; open one of those to see the perfusion record.</p>
        </section>
      )}

      {captured && q && (
        <section className="kpis">
          <Kpi label="DO2i nadir (full flow)" value={num(q.do2iNadir, 0, "mL/min/m²")} />
          <Kpi label="Time DO2i < 280" value={`${duration(q.secondsDo2iBelowTarget)} (${num(q.pctTimeDo2iBelowTarget, 1)}%)`} warn={(q.pctTimeDo2iBelowTarget ?? 0) >= 10} />
          <Kpi label="SvO2 nadir" value={num(q.svo2Nadir, 1, "%")} warn={(q.svo2Nadir ?? 100) < 55} />
          <Kpi label="Time MAP < 50" value={duration(q.secondsMapBelow50)} warn={(q.secondsMapBelow50 ?? 0) > 300} />
          <Kpi label="Max arterial outlet" value={num(q.maxArterialTemp, 1, "°C")} warn={(q.maxArterialTemp ?? 0) > 37} />
          <Kpi label="Emboli detected" value={String(q.emboliCount)} note={`${c.emboli.totalVolumeNl.toLocaleString()} nL estimated`} />
          <Kpi label="Alarms" value={String(q.alarmCount)} note={`${num(q.artifactPct, 2)}% samples flagged`} />
        </section>
      )}

      {captured && recording && (
        <section className="card">
          <div className="toolbar">
            <div style={{ flex: 1 }}>
              <h2>Perfusion record</h2>
              <p className="model-note">
                {c.series.resolution === "RAW"
                  ? `Raw 1-second samples, ${clock(c.series.from, true)}–${clock(c.series.to, true)}. Invalid samples (line flush, artifact) show as gaps.`
                  : `${c.series.stepSeconds / 60}-minute mean with min–max band, from the minute aggregates. Click a chart to zoom to 10 minutes of raw seconds.`}
                {" "}Shaded: cross-clamp. Dashed: thresholds.
              </p>
            </div>
            <span className="badge">{c.series.resolution === "RAW" ? "1 s raw" : `${c.series.stepSeconds / 60} min`}</span>
          </div>
          <Suspense>
            <SeriesControls channels={channels.map((ch) => ({ code: ch.code, name: ch.name }))} selected={selected} windows={c.phaseWindows} />
            <PerfusionChart series={c.series} windows={c.phaseWindows} recording={recording} />
          </Suspense>
        </section>
      )}

      {captured && (
        <section className="card table-wrap">
          <h2>By phase</h2>
          <p className="model-note">Median (min–max) for each channel in each phase; percentiles are exact, computed from raw samples after capture.</p>
          <table>
            <thead><tr><th>Channel</th>{phaseOrder.map((p) => <th key={p} className="num">{PHASE_LABEL[p]}</th>)}</tr></thead>
            <tbody>
              {phaseRows.map((r) => (
                <tr key={r.code}>
                  <td><strong>{r.code}</strong></td>
                  {phaseOrder.map((p) => {
                    const s = r.byPhase[p];
                    return <td key={p} className="num">{s?.p50 != null ? <>{s.p50} <span className="hint">({s.min}–{s.max})</span></> : "-"}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {captured && (
        <div className="grid-2">
          <section className="card table-wrap">
            <h2>Episodes below target</h2>
            <p className="model-note">Continuous runs of at least 10 s during full-flow bypass (gaps-and-islands in SQL).</p>
            <table>
              <thead><tr><th>Channel</th><th>Start</th><th className="num">Duration</th><th className="num">Worst</th></tr></thead>
              <tbody>
                {[...c.do2i.map((e) => ({ ...e, ch: "DO2i < 280" })), ...c.map.map((e) => ({ ...e, ch: "MAP < 50" }))]
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .map((e) => (
                    <tr key={e.ch + e.start}><td>{e.ch}</td><td>{clock(e.start, true)}</td><td className="num">{duration(e.seconds)}</td><td className="num">{e.extreme.toFixed(0)}</td></tr>
                  ))}
                {c.do2i.length + c.map.length === 0 && <tr><td colSpan={4} className="muted">None.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="card table-wrap">
            <h2>Alarms</h2>
            <table>
              <thead><tr><th>Time</th><th>Channel</th><th className="num">Value</th><th className="num">Limit</th><th className="num">Ack</th></tr></thead>
              <tbody>
                {c.alarms.map((a) => (
                  <tr key={a.ts + a.channel.code}><td>{clock(a.ts, true)}</td><td>{a.channel.code}</td><td className="num">{a.value.toFixed(1)}</td>
                    <td className="num">{a.limitKind === "low" ? "<" : ">"} {a.limitValue}</td><td className="num">{duration(a.ackSeconds)}</td></tr>
                ))}
                {c.alarms.length === 0 && <tr><td colSpan={5} className="muted">None.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <div className="grid-2">
        <section className="card table-wrap">
          <h2>Timeline</h2>
          <table>
            <tbody>
              {[
                ...c.events.map((e) => ({
                  ts: e.ts, label: e.type.replaceAll("_", " "), setting: false,
                  note: e.type === "cardioplegia" ? `${e.detail.dose_ml} mL at ${e.detail.temp_c} °C` : e.type === "heparin" ? `${e.detail.dose_units} units` : "",
                })),
                // setting changes (not the initial settings), merged into the same timeline
                ...c.settingChanges.filter((s) => s.oldValue != null).map((s) => ({ ts: s.ts, label: s.parameter, setting: true, note: `${s.oldValue} → ${s.newValue}` })),
              ].sort((a, b) => a.ts.localeCompare(b.ts)).map((r, i) => (
                <tr key={i} className={r.setting ? "setting" : ""}><td>{clock(r.ts)}</td><td>{r.label}</td><td className="hint">{r.note}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        {captured && (
          <section className="card table-wrap">
            <h2>Point-of-care labs</h2>
            <table>
              <thead><tr><th>Time</th><th>Test</th><th className="num">Value</th></tr></thead>
              <tbody>
                {c.labs.map((l, i) => <tr key={i}><td>{clock(l.ts)}</td><td>{l.test}</td><td className="num">{l.value} {l.unit}</td></tr>)}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {captured && (
        <div className="grid-2">
          <section className="card table-wrap">
            <h2>Provenance</h2>
            <p className="model-note">Which device recorded what, on which software, and whether its maintenance was current at the time.</p>
            <table>
              <thead><tr><th>Device</th><th>Software</th><th className="num">Clock offset</th><th>Maintenance at capture</th></tr></thead>
              <tbody>
                {c.sessions.map((s) => (
                  <tr key={s.device.id + s.startedAt}>
                    <td><Link href={`/devices/${s.device.id}`}>{s.device.assetTag}</Link> <span className="hint">{s.device.model}</span></td>
                    <td>{s.softwareVersion}</td>
                    <td className="num">{s.clockOffsetMs} ms</td>
                    <td>{s.maintenanceOk
                      ? <span className="badge ok">Current</span>
                      : <><span className="badge bad">Overdue</span><div className="hint wrap">{s.maintenanceNote?.replace("Overdue at capture: ", "")}</div></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card table-wrap">
            <h2>Disposables</h2>
            <table>
              <thead><tr><th>Product</th><th>Lot</th><th>Expires</th></tr></thead>
              <tbody>
                {c.disposables.map((d) => (
                  <tr key={d.lot}><td>{d.product}</td><td><Link href={`/devices?lot=${encodeURIComponent(d.lot)}`}>{d.lot}</Link></td><td>{d.expiresOn}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, note, warn }: { label: string; value: string; note?: string; warn?: boolean }) {
  return (
    <div className={`card kpi ${warn ? "kpi-warn" : ""}`}>
      <div className="value small">{value}</div><div className="label">{label}</div>{note && <div className="hint">{note}</div>}
    </div>
  );
}
