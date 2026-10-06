import { NextResponse, type NextRequest } from "next/server";
import { decrypt, SESSION_COOKIE } from "@/lib/token";

// Fast first gate: bounce anonymous users before a protected page renders.
// Not the only check - lib/dal.ts verifySession() re-checks wherever data is read.
const PROTECTED = ["/dashboard", "/cases", "/api"];

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const session = await decrypt(req.cookies.get(SESSION_COOKIE)?.value);

  if (PROTECTED.some((p) => pathname.startsWith(p)) && !session) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL("/login", req.url);
    url.searchParams.set("next", pathname + search);   // remember where they were going
    return NextResponse.redirect(url);
  }

  if (pathname === "/login" && session) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
