import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { listScanJobs, queueScans } from "@/lib/scan/service";
import { getWorkerHealth, isScanWorkerOnline } from "@/lib/jobs/health";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    const workerOnline = isScanWorkerOnline(await getWorkerHealth());
    return NextResponse.json({ results, workerOnline, inline: env.inlineJobs }, { status: 202 });
  });
}
