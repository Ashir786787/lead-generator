import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import {
  activateProfile,
  createProfileVersion,
  listProfiles,
  previewProfileImpact,
} from "@/lib/score/service";
import { scoreConfigSchema } from "@/lib/score/config";
import { sendJob, JOB_NAMES } from "@/lib/jobs/boss";
import { publishEvent } from "@/lib/events/bus";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("preview"), config: scoreConfigSchema }),
  z.object({ action: z.literal("save"), config: scoreConfigSchema }),
  z.object({ action: z.literal("activate"), profileId: z.string().uuid() }),
  z.object({ action: z.literal("recalculate") }),
]);

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const profiles = await listProfiles(ctx.workspaceId);
    const active = profiles.find((profile) => profile.isActive) ?? null;
    return NextResponse.json({ active, profiles });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`score:${ctx.user.id}`, 20, 60_000);
    const body = postSchema.parse(await request.json());
    if (body.action === "preview") {
      return NextResponse.json({ impact: await previewProfileImpact(ctx.workspaceId, body.config) });
    }
    if (body.action === "save") {
      const profile = await createProfileVersion(ctx.workspaceId, body.config, ctx.user.id);
      await sendJob(
        JOB_NAMES.scoreRecalculate,
        { workspaceId: ctx.workspaceId, requestedBy: ctx.user.id },
        { retryLimit: 1 },
      );
      await publishEvent(ctx.workspaceId, "score.recalculated", { scheduled: true });
      return NextResponse.json({ profile, recalculating: true }, { status: 201 });
    }
    if (body.action === "activate") {
      await activateProfile(ctx.workspaceId, body.profileId);
      await sendJob(
        JOB_NAMES.scoreRecalculate,
        { workspaceId: ctx.workspaceId, requestedBy: ctx.user.id },
        { retryLimit: 1 },
      );
      return NextResponse.json({ ok: true, recalculating: true });
    }
    await sendJob(
      JOB_NAMES.scoreRecalculate,
      { workspaceId: ctx.workspaceId, requestedBy: ctx.user.id },
      { retryLimit: 1 },
    );
    return NextResponse.json({ ok: true, queued: true }, { status: 202 });
  });
}
