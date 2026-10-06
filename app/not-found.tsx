import Link from "next/link";

export default function NotFound() {
  return (
    <main className="login-wrap">
      <div className="card"><h1>Not found</h1><p><Link href="/dashboard">Back to analytics</Link></p></div>
    </main>
  );
}
