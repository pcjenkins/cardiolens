import Link from "next/link";
import { Suspense } from "react";
import { verifySession } from "@/lib/dal";
import { listCases, PROCEDURES } from "@/lib/queries";
import ProcedureFilter from "@/components/ProcedureFilter";

export const metadata = { title: "Cases | CardioLens" };

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ procedure?: string; surgeon?: string }> }) {
  await verifySession();
  const { procedure: raw, surgeon } = await searchParams;
  const procedure = PROCEDURES.includes(raw as (typeof PROCEDURES)[number]) ? raw : undefined;
  const rows = listCases({ procedure, surgeon: surgeon?.slice(0, 50) });

  return (
    <>
      <div className="toolbar">
        <div style={{ flex: 1 }}>
          <h1>Cases</h1>
          <p className="muted">Most recent {rows.length} cases</p>
        </div>
        {/* Plain GET form: works with zero JavaScript, like a classic MVC search form */}
        <form className="toolbar" method="get">
          {procedure && <input type="hidden" name="procedure" value={procedure} />}
          <label>Surgeon<input name="surgeon" defaultValue={surgeon} placeholder="e.g. Raman" /></label>
          <button type="submit" style={{ marginTop: 0 }}>Search</button>
        </form>
        <Suspense><ProcedureFilter procedures={PROCEDURES} /></Suspense>
      </div>

      <section className="card table-wrap">
        <table>
          <thead>
            <tr><th>Case</th><th>Date</th><th>Procedure</th><th>Surgeon</th><th>Facility</th>
                <th className="num">Bypass</th><th className="num">Clamp</th><th className="num">LOS</th><th>Outcome</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/cases/${r.id}`}>#{r.id}</Link></td>
                <td>{r.case_date}</td><td>{r.procedure}</td><td>{r.surgeon}</td><td>{r.facility}</td>
                <td className="num">{r.bypass_min}</td><td className="num">{r.cross_clamp_min}</td><td className="num">{r.los_days}</td>
                <td><span className={`badge ${r.outcome === "Discharged" ? "" : "bad"}`}>{r.outcome}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
