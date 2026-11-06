import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { startImport } from "@/lib/import/service";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  mapping: z.record(z.string(), z.string()).optional(),
  force: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    checkRateLimit(`import-start:${ctx.user.id}`, 30, 60_000);
    const body = schema.parse(await request.json().catch(() => ({})));
    const result = await startImport(ctx, id, body.mapping, { force: body.force });
    return NextResponse.json(result, { status: result.queued ? 202 : 200 });
  });
}
