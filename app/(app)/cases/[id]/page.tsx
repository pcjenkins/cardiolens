import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { getCase } from "@/lib/queries";

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  await verifySession();
  const { id } = await params;                 // dynamic segment from the folder name [id]
  const caseId = Number(id);
  if (!Number.isInteger(caseId) || caseId < 1) notFound();
  const c = getCase(caseId);
  if (!c) notFound();

  return (
    <>
      <p><Link href="/cases">← All cases</Link></p>
      <section className="card">
        <h1>Case #{c.id}</h1>
        <dl className="detail">
          <dt>Date</dt><dd>{c.case_date}</dd>
          <dt>Procedure</dt><dd>{c.procedure}</dd>
          <dt>Surgeon</dt><dd>{c.surgeon}</dd>
          <dt>Facility</dt><dd>{c.facility}</dd>
          <dt>Bypass time</dt><dd>{c.bypass_min} min</dd>
          <dt>Cross-clamp time</dt><dd>{c.cross_clamp_min} min</dd>
          <dt>Lowest temperature</dt><dd>{c.lowest_temp_c} °C</dd>
          <dt>Blood products</dt><dd>{c.blood_units} units</dd>
          <dt>Length of stay</dt><dd>{c.los_days} days</dd>
          <dt>Outcome</dt><dd>{c.outcome}</dd>
        </dl>
      </section>
    </>
  );
}
