import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { createImportPreview, listImports } from "@/lib/import/service";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { conflict } from "@/lib/api/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    return NextResponse.json({ items: await listImports(ctx) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`import:${ctx.user.id}`, 20, 60_000);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw conflict("Choose a CSV, TSV, GeoJSON or ZIP file to upload.");
    const preview = await createImportPreview(ctx, file);
    return NextResponse.json(preview, { status: 201 });
  });
}
