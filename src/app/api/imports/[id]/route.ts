import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { deleteImport, getImport } from "@/lib/import/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    return NextResponse.json(await getImport(ctx, id));
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    await deleteImport(ctx, id);
    return NextResponse.json({ ok: true });
  });
}
