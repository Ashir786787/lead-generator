import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { listScanJobs, queueScans } from "@/lib/scan/service";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ force: z.boolean().optional() });

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    return NextResponse.json({ items: await listScanJobs(ctx, id) });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    checkRateLimit(`scan:${ctx.user.id}`, 20, 60_000);
    const raw = await request.json().catch(() => ({}));
    const body = bodySchema.parse(raw);
    const results = await queueScans(ctx, [id], Boolean(body.force));
    return NextResponse.json({ results }, { status: 202 });
  });
}
