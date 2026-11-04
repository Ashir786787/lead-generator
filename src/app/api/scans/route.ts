import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { listScanJobs, scanQueueSummary } from "@/lib/scan/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const businessId = new URL(request.url).searchParams.get("businessId") ?? undefined;
    const [items, summary] = await Promise.all([
      listScanJobs(ctx, businessId),
      scanQueueSummary(ctx),
    ]);
    return NextResponse.json({ items, summary });
  });
}
