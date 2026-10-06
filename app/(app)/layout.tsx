import Link from "next/link";
import type { ReactNode } from "react";
import { verifySession } from "@/lib/dal";
import { logout } from "@/app/login/actions";


// Route group "(app)": every page inside shares this authenticated shell. The folder name is not in the URL.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await verifySession();
  return (
    <>
      <header className="topbar">
        <span className="brand">CardioLens</span>
        <nav>
          <Link href="/dashboard">Analytics</Link>
          <Link href="/cases">Cases</Link>
	  {session.role === "admin" && <Link href="/admin">Admin</Link>}
        </nav>
        <div className="user">
          <span>{session.name} · {session.role}</span>
          <form action={logout}><button className="link" type="submit">Sign out</button></form>
        </div>
      </header>
      <main className="container">{children}</main>
    </>
  );
}
