import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { listDuplicatePairs } from "@/lib/dedupe/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    return NextResponse.json({ items: await listDuplicatePairs(ctx) });
  });
}
