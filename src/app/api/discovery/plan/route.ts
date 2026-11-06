import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { planDiscovery, plannerStatuses } from "@/lib/discovery/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const planSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "Ask for leads or for guidance on choosing them.")
    .max(600, "Keep the request under 600 characters."),
  planner: z.enum(["auto", "gemini", "grok", "groq"]).default("auto"),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(1600),
      }),
    )
    .max(10)
    .default([]),
});

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`discovery-plan:${ctx.user.id}`, 10, 60_000);
    const body = planSchema.parse(await request.json());
    const plan = await planDiscovery({
      prompt: body.prompt,
      planner: body.planner,
      history: body.history,
    });
    return NextResponse.json({ plan, planners: plannerStatuses() });
  });
}

export async function GET() {
  return apiRoute(async () => {
    await getWorkspaceContext();
    return NextResponse.json({ planners: plannerStatuses() });
  });
}
