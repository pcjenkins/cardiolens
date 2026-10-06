import Link from "next/link";
import { Suspense } from "react";
import { verifySession } from "@/lib/dal";
import { kpis, weeklyBypass, bypassByProcedure, PROCEDURES } from "@/lib/queries";
import { buildTrendSeries, zScoreOutliers } from "@/lib/analytics";
import TrendChart from "@/components/TrendChart";
import ProcedureFilter from "@/components/ProcedureFilter";

export const metadata = { title: "Analytics | CardioLens" };

// Server component: runs only on the server, reads SQLite directly, ships no DB code to the browser.
export default async function Dashboard({ searchParams }: { searchParams: Promise<{ procedure?: string }> }) {
  await verifySession();
  const { procedure: raw } = await searchParams;
  const procedure = PROCEDURES.includes(raw as (typeof PROCEDURES)[number]) ? raw : undefined; // allow-list

  const k = kpis(procedure);
  const { series, fit } = buildTrendSeries(weeklyBypass(procedure));

  // Outliers are judged within each procedure type - a long MVR is not the same as a long CABG.
  const all = bypassByProcedure().filter((r) => !procedure || r.procedure === procedure);
  const outliers = PROCEDURES.flatMap((p) => {
    const rows = all.filter((r) => r.procedure === p);
    return zScoreOutliers(rows.map((r) => r.bypass_min)).map((i) => rows[i]);
  }).sort((a, b) => b.bypass_min - a.bypass_min);

  const direction = fit.slope < 0 ? "improving" : "worsening";
  const perWeek = Math.abs(fit.slope).toFixed(2);

  return (
    <>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Bypass time analytics</h1>
          <p className="muted">{procedure ?? "All procedures"} · last 26 weeks</p>
        </div>
        <Suspense><ProcedureFilter procedures={PROCEDURES} /></Suspense>
      </div>

      <section className="kpis">
        <Kpi label="Cases" value={k.cases.toString()} />
        <Kpi label="Avg bypass time" value={`${k.avg_bypass} min`} />
        <Kpi label="Avg length of stay" value={`${k.avg_los} days`} />
        <Kpi label="Complication / readmit rate" value={`${k.complication_rate}%`} />
      </section>

      <section className="card">
        <h2>Weekly mean bypass time</h2>
        <TrendChart data={series} />
        <p className="model-note">
          Model: weekly mean, 4-week moving average, and an ordinary least-squares trend.
          Trend is <strong>{direction}</strong> by {perWeek} min/week (R² = {fit.r2.toFixed(2)}).
        </p>
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
                  <td>{o.case_date}</td><td>{o.procedure}</td><td>{o.surgeon}</td>
                  <td className="num">{o.bypass_min}</td>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="card kpi"><div className="value">{value}</div><div className="label">{label}</div></div>;
}
