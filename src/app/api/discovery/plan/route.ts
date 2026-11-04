import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { planDiscovery, plannerStatuses } from "@/lib/discovery/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(3, "Describe the businesses and location you want.")
    .max(600, "Keep the request under 600 characters."),
  planner: z.enum(["auto", "gemini", "grok", "groq"]).default("auto"),
});

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`discovery-plan:${ctx.user.id}`, 10, 60_000);
    const body = planSchema.parse(await request.json());
    const plan = await planDiscovery({ prompt: body.prompt, planner: body.planner });
    return NextResponse.json({ plan, planners: plannerStatuses() });
  });
}

export async function GET() {
  return apiRoute(async () => {
    await getWorkspaceContext();
    return NextResponse.json({ planners: plannerStatuses() });
  });
}
