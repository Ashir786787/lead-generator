import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { deleteSavedView } from "@/lib/data/saved-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    await deleteSavedView(ctx, id);
    return NextResponse.json({ ok: true });
  });
}
