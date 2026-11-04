import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { firstWorkspaceId, getSetupStatus, ownerHint } from "@/lib/setup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return apiRoute(async () => {
    const status = await getSetupStatus();
    return NextResponse.json({
      ...status,
      ownerHint: status.needsSetup ? await ownerHint() : "",
      firstWorkspaceUserId: status.needsSetup ? null : await firstWorkspaceId(),
    });
  });
}
