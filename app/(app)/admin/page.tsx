import Link from "next/link";
import { notFound } from "next/navigation";
import { verifySession } from "@/lib/dal";
import { gql } from "@/lib/api";

export const metadata = { title: "Admin | CardioLens" };

type Data = {
  dataVolume: {
    dirtyBuckets: number;
    partitions: { name: string; range: string; rows: number; bytes: number }[];
    tables: { name: string; rows: number; bytes: number }[];
  };
};

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export default async function AdminPage() {
  const session = await verifySession();          // must be logged in
  if (session.role !== "admin") notFound();       // and an admin; the API enforces this again
  const { dataVolume: v } = await gql<Data>(`{ dataVolume { dirtyBuckets partitions { name range rows bytes } tables { name rows bytes } } }`);
  const total = v.partitions.reduce((n, p) => n + p.bytes, 0);

  return (
    <>
      <section className="card">
        <h1>Admin</h1>
        <p className="muted">Signed in as {session.name} ({session.role})</p>
        <p><Link href="/admin/tests">View release test results →</Link></p>
      </section>

      <section className="card table-wrap">
        <h2>Raw sample time shards</h2>
        <p className="model-note">
          raw_sample is range-partitioned by month. Each partition has its own BRIN index on time; an old month can be
          detached and archived without a bulk delete. Row counts are planner estimates (pg_class.reltuples). Total {mb(total)}.
        </p>
        <table>
          <thead><tr><th>Partition</th><th>Range</th><th className="num">Rows</th><th className="num">Size</th></tr></thead>
          <tbody>
            {v.partitions.map((p) => (
              <tr key={p.name}><td>{p.name}</td><td className="hint">{p.range.replace("FOR VALUES ", "")}</td>
                <td className="num">{Math.round(p.rows).toLocaleString()}</td><td className="num">{mb(p.bytes)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card table-wrap">
        <h2>Aggregates and events</h2>
        <p className="model-note">Ingest backlog: {v.dirtyBuckets} hour/day buckets waiting for rollup_dirty().</p>
        <table>
          <thead><tr><th>Table</th><th className="num">Rows</th><th className="num">Size</th></tr></thead>
          <tbody>
            {v.tables.map((t) => <tr key={t.name}><td>{t.name}</td><td className="num">{Math.round(t.rows).toLocaleString()}</td><td className="num">{mb(t.bytes)}</td></tr>)}
          </tbody>
        </table>
      </section>
    </>
  );
}
