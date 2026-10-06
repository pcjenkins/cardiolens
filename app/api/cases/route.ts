import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { decrypt, SESSION_COOKIE } from "@/lib/token";
import { listCases, PROCEDURES } from "@/lib/queries";

// REST endpoint (the "Web API controller"): GET /api/cases?procedure=CABG
export async function GET(req: NextRequest) {
  const session = await decrypt((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const raw = req.nextUrl.searchParams.get("procedure") ?? undefined;
  const procedure = PROCEDURES.includes(raw as (typeof PROCEDURES)[number]) ? raw : undefined;
  return NextResponse.json({ cases: listCases({ procedure, limit: 50 }) });
}
