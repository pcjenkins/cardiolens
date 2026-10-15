import { NextResponse, type NextRequest } from "next/server";
import { ApiError, gql } from "@/lib/api";
import { verifyApiSession } from "@/lib/dal";

// REST endpoint (the "Web API controller"): GET /api/cases?procedure=CABG
// A thin REST facade over the same GraphQL data service the pages use.
export async function GET(req: NextRequest) {
  if (!(await verifyApiSession())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const procedure = req.nextUrl.searchParams.get("procedure");
  try {
    const data = await gql<{ cases: unknown[] }>(
      `query ($filter: CaseFilter) { cases(filter: $filter, limit: 50) { id caseDate procedure surgeon { name } bypassMin crossClampMin losDays outcome source } }`,
      { filter: { procedure } });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e instanceof ApiError ? e.message : "Request failed" }, { status: 502 });
  }
}
