import { NextResponse } from "next/server";
import { ApiError, gql } from "@/lib/api";

// GET /cases/:id/report - the whole case as one JSON document, assembled in the database by case_report().
// The proxy has already bounced anonymous users; the API re-checks the forwarded session.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const data = await gql<{ case: { report: unknown } | null }>(`query Report($id: ID!) { case(id: $id) { report } }`, { id });
    if (!data.case) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(data.case.report, { headers: { "content-disposition": `inline; filename="case-${id}.json"` } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof ApiError ? e.message : "Report failed" }, { status: 502 });
  }
}
