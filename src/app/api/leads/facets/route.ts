import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getLeadFacets, getWorkspaceOverview } from "@/lib/data/facets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const [facets, overview] = await Promise.all([getLeadFacets(ctx), getWorkspaceOverview(ctx)]);
    return NextResponse.json({ facets, overview });
  });
}
