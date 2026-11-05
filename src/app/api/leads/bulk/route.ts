import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { bulkAddTag, bulkArchive, bulkSetStatus } from "@/lib/data/mutations";
import { queueScans } from "@/lib/scan/service";
import { getWorkerHealth, isScanWorkerOnline } from "@/lib/jobs/health";
import { PIPELINE_STATUSES } from "@/lib/constants";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    status: z.enum(PIPELINE_STATUSES),
  }),
  z.object({
    action: z.literal("tag"),
    ids: z.array(z.string().uuid()).min(1).max(500),
    tag: z.string().trim().min(1).max(40),
  }),
  z.object({
    action: z.literal("archive"),
    ids: z.array(z.string().uuid()).min(1).max(500),
  }),
  z.object({
    action: z.literal("scan"),
    ids: z.array(z.string().uuid()).min(1).max(100),
    force: z.boolean().optional(),
  }),
]);

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`bulk:${ctx.user.id}`, 30, 60_000);
    const body = schema.parse(await request.json());
    if (body.action === "status") {
      return NextResponse.json({ affected: await bulkSetStatus(ctx, body.ids, body.status) });
    }
    if (body.action === "tag") {
      return NextResponse.json({ affected: await bulkAddTag(ctx, body.ids, body.tag) });
    }
    if (body.action === "archive") {
      return NextResponse.json({ affected: await bulkArchive(ctx, body.ids) });
    }
    const results = await queueScans(ctx, body.ids, Boolean(body.force));
    const workerOnline = isScanWorkerOnline(await getWorkerHealth());
    return NextResponse.json({ results, workerOnline }, { status: 202 });
  });
}
