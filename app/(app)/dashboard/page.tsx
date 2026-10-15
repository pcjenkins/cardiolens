import Link from "next/link";
import { Suspense } from "react";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";
import { buildTrendSeries, zScoreOutliers, type WeeklyPoint } from "@/lib/analytics";
import { num } from "@/lib/format";
import type { Staff } from "@/lib/types";
import TrendChart from "@/components/TrendChart";
import ProcedureFilter from "@/components/ProcedureFilter";

export const metadata = { title: "Analytics | CardioLens" };

type Data = {
  procedures: string[];
  dashboard: {
    kpis: { cases: number; capturedCases: number; avgBypassMin: number | null; avgLosDays: number | null; complicationRate: number | null };
    weekly: WeeklyPoint[];
    bypassByCase: { id: string; caseDate: string; procedure: string; surgeon: string; bypassMin: number }[];
    perfusionQuality: { perfusionist: Staff; cases: number; medianDo2i: number | null; pctTimeDo2iBelowTarget: number | null; pctTimeMapBelow50: number | null; pctTimeArterialAbove37: number | null }[];
  };
};

// One round trip for the whole page; the API resolves only the fields asked for.
const QUERY = `query Dashboard($procedure: String) {
  procedures
  dashboard(procedure: $procedure) {
    kpis { cases capturedCases avgBypassMin avgLosDays complicationRate }
    weekly { week mean cases }
    bypassByCase { id caseDate procedure surgeon bypassMin }
    perfusionQuality { perfusionist { id name } cases medianDo2i pctTimeDo2iBelowTarget pctTimeMapBelow50 pctTimeArterialAbove37 }
  }
}`;

// Server component: it calls the GraphQL data service from the server. No database code, and no API URL, reach the browser.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ procedure?: string }> }) {
  await verifySession();
  const { procedure: raw } = await searchParams;
  const { procedures, dashboard: d } = await gql<Data>(QUERY, { procedure: raw ?? null });   // the API allow-lists procedure
  const procedure = raw && procedures.includes(raw) ? raw : undefined;

  const { series, fit } = buildTrendSeries(d.weekly);
  // Outliers are judged within each procedure type - a long MVR is not the same as a long CABG.
  const outliers = procedures.flatMap((p) => {
    const rows = d.bypassByCase.filter((r) => r.procedure === p);
    return zScoreOutliers(rows.map((r) => r.bypassMin)).map((i) => rows[i]);
  }).sort((a, b) => b.bypassMin - a.bypassMin);
  const direction = fit.slope < 0 ? "improving" : "worsening";

  return (
    <>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Bypass time analytics</h1>
          <p className="muted">{procedure ?? "All procedures"} · last 26 weeks</p>
        </div>
        <Suspense><ProcedureFilter procedures={procedures} /></Suspense>
      </div>

      <section className="kpis">
        <Kpi label="Cases" value={d.kpis.cases.toString()} note={`${d.kpis.capturedCases} with per-second capture`} />
        <Kpi label="Avg bypass time" value={num(d.kpis.avgBypassMin, 1, "min")} />
        <Kpi label="Avg length of stay" value={num(d.kpis.avgLosDays, 1, "days")} />
        <Kpi label="Complication / readmit rate" value={num(d.kpis.complicationRate, 1, "%")} />
      </section>

      <section className="card">
        <h2>Weekly mean bypass time</h2>
        <TrendChart data={series} />
        <p className="model-note">
          Model: weekly mean, 4-week moving average, and an ordinary least-squares trend.
          Trend is <strong>{direction}</strong> by {Math.abs(fit.slope).toFixed(2)} min/week (R² = {fit.r2.toFixed(2)}).
        </p>
      </section>

      <section className="card">
        <h2>Goal-directed perfusion by perfusionist</h2>
        <p className="model-note">
          Full-flow bypass of captured cases (initiation and weaning excluded). Target: indexed O2 delivery (DO2i) ≥ 280 mL/min/m²,
          MAP ≥ 50 mmHg, arterial outlet ≤ 37 °C. Computed in the data tier from the per-phase aggregates.
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Perfusionist</th><th className="num">Cases</th><th className="num">Median DO2i</th>
              <th className="num">Time DO2i &lt; 280</th><th className="num">Time MAP &lt; 50</th><th className="num">Time arterial &gt; 37 °C</th></tr></thead>
            <tbody>
              {d.perfusionQuality.map((p) => (
                <tr key={p.perfusionist.id}>
                  <td>{p.perfusionist.name}</td>
                  <td className="num">{p.cases}</td>
                  <td className="num">{num(p.medianDo2i)}</td>
                  <td className="num"><Pct value={p.pctTimeDo2iBelowTarget} warn={10} /></td>
                  <td className="num"><Pct value={p.pctTimeMapBelow50} warn={5} /></td>
                  <td className="num"><Pct value={p.pctTimeArterialAbove37} warn={10} /></td>
                </tr>
              ))}
              {d.perfusionQuality.length === 0 && <tr><td colSpan={6} className="muted">No captured cases in this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Outlier cases</h2>
        <p className="model-note">Bypass time more than 2.5 standard deviations from the mean for the same procedure.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Case</th><th>Date</th><th>Procedure</th><th>Surgeon</th><th className="num">Bypass (min)</th></tr></thead>
            <tbody>
              {outliers.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/cases/${o.id}`}>#{o.id}</Link></td>
                  <td>{o.caseDate}</td><td>{o.procedure}</td><td>{o.surgeon}</td>
                  <td className="num">{o.bypassMin}</td>
                </tr>
              ))}
              {outliers.length === 0 && <tr><td colSpan={5} className="muted">No outliers in this selection.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="card kpi"><div className="value">{value}</div><div className="label">{label}</div>{note && <div className="hint">{note}</div>}</div>;
}

function Pct({ value, warn }: { value: number | null; warn: number }) {
  if (value == null) return <>-</>;
  return <span className={value >= warn ? "warn-text" : ""}>{value.toFixed(1)}%</span>;
}
