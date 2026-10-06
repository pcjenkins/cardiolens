import { verifySession } from "@/lib/dal";
import { queryOne } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";

export const metadata = { title: "Admin | CardioLens" };

export default async function AdminPage() {
  const session = await verifySession();          // must be logged in
  if (session.role !== "admin") notFound();  
  const counts = queryOne<{ users: number; cases: number }>(
    "SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM cases) AS cases"
  );

  return (
    <section className="card">
      <h1>Admin</h1>
      <p className="muted">Signed in as {session.name} ({session.role})</p>
      <p>Users: {counts?.users} · Cases: {counts?.cases}</p>
      <p><Link href="/admin/tests">View release test results →</Link></p>
    </section>
  );
}