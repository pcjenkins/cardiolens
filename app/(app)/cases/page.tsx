import Link from "next/link";
import { Suspense } from "react";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";
import type { CaseListItem } from "@/lib/types";
import ProcedureFilter from "@/components/ProcedureFilter";

export const metadata = { title: "Cases | CardioLens" };

// `quality` per row is batched by a DataLoader in the API: 100 rows, one quality query.
const QUERY = `query Cases($filter: CaseFilter, $limit: Int) {
  procedures
  cases(filter: $filter, limit: $limit) {
    id caseDate procedure source surgeon { id name } perfusionist { id name } facility room
    bypassMin crossClampMin losDays outcome
    quality { pctTimeDo2iBelowTarget }
  }
}`;

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ procedure?: string; surgeon?: string; captured?: string }> }) {
  await verifySession();
  const { procedure, surgeon, captured } = await searchParams;
  const { procedures, cases } = await gql<{ procedures: string[]; cases: CaseListItem[] }>(QUERY, {
    filter: { procedure: procedure || null, surgeon: surgeon?.slice(0, 50) || null, capturedOnly: captured === "1" },
    limit: 100,
  });

  return (
    <>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Cases</h1>
          <p className="muted">Most recent {cases.length} cases</p>
        </div>
        {/* Plain GET form: works with zero JavaScript, like a classic MVC search form */}
        <form className="toolbar" method="get">
          {procedure && <input type="hidden" name="procedure" value={procedure} />}
          <label>Surgeon<input name="surgeon" defaultValue={surgeon} placeholder="e.g. Raman" /></label>
          <label className="check"><input type="checkbox" name="captured" value="1" defaultChecked={captured === "1"} /> Captured only</label>
          <button type="submit" style={{ marginTop: 0 }}>Search</button>
        </form>
        <Suspense><ProcedureFilter procedures={procedures} /></Suspense>
      </div>

      <section className="card table-wrap">
        <table>
          <thead>
            <tr><th>Case</th><th>Date</th><th>Procedure</th><th>Surgeon</th><th>Perfusionist</th><th>Room</th>
                <th className="num">Bypass</th><th className="num">Clamp</th><th className="num">DO2i &lt; 280</th><th className="num">LOS</th><th>Outcome</th><th>Data</th></tr>
          </thead>
          <tbody>
            {cases.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/cases/${r.id}`}>#{r.id}</Link></td>
                <td>{r.caseDate}</td><td>{r.procedure}</td><td>{r.surgeon?.name}</td><td>{r.perfusionist?.name}</td>
                <td>{r.facility.split(" ")[0]} · {r.room}</td>
                <td className="num">{r.bypassMin}</td><td className="num">{r.crossClampMin}</td>
                <td className="num">{r.quality?.pctTimeDo2iBelowTarget != null ? `${r.quality.pctTimeDo2iBelowTarget.toFixed(1)}%` : "-"}</td>
                <td className="num">{r.losDays}</td>
                <td><span className={`badge ${r.outcome === "Discharged" ? "" : "bad"}`}>{r.outcome}</span></td>
                <td><span className={`badge ${r.source === "live_capture" ? "ok" : "muted-badge"}`}>{r.source === "live_capture" ? "Per-second" : "Legacy"}</span></td>
              </tr>
            ))}
            {cases.length === 0 && <tr><td colSpan={12} className="muted">No cases match.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
