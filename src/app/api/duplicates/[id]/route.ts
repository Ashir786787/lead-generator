import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { resolveDuplicate } from "@/lib/dedupe/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["merge", "keep_separate", "skip"]),
  keep: z.enum(["a", "b"]).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    const body = schema.parse(await request.json());
    await resolveDuplicate(ctx, id, body.action, body.keep ?? "a");
    return NextResponse.json({ ok: true });
  });
}
