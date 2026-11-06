import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import {
  activateProfile,
  createProfileVersion,
  listProfiles,
  previewProfileImpact,
  recalculateWorkspaceScores,
} from "@/lib/score/service";
import { scoreConfigSchema } from "@/lib/score/config";
import { sendJob, JOB_NAMES } from "@/lib/jobs/boss";
import { publishEvent } from "@/lib/events/bus";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function recalculate(workspaceId: string, userId: string): Promise<{ inline: boolean }> {
  if (env.inlineJobs) {
    await recalculateWorkspaceScores(workspaceId, async (done, total) => {
      await publishEvent(workspaceId, "score.recalculated", { done, total });
    });
    return { inline: true };
  }
  await sendJob(
    JOB_NAMES.scoreRecalculate,
    { workspaceId, requestedBy: userId },
    { retryLimit: 1 },
  );
  return { inline: false };
}

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
      const result = await recalculate(ctx.workspaceId, ctx.user.id);
      await publishEvent(ctx.workspaceId, "score.recalculated", { scheduled: true });
      return NextResponse.json({ profile, recalculating: !result.inline }, { status: 201 });
    }
    if (body.action === "activate") {
      await activateProfile(ctx.workspaceId, body.profileId);
      const result = await recalculate(ctx.workspaceId, ctx.user.id);
      return NextResponse.json({ ok: true, recalculating: !result.inline });
    }
    const result = await recalculate(ctx.workspaceId, ctx.user.id);
    return NextResponse.json({ ok: true, queued: !result.inline, recalculated: result.inline }, { status: 202 });
  });
}
