import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { createSavedView, listSavedViews } from "@/lib/data/saved-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  query: z.record(z.string(), z.string().max(4000)).default({}),
});

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    return NextResponse.json({ items: await listSavedViews(ctx) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const body = schema.parse(await request.json());
    const view = await createSavedView(ctx, body.name, body.query);
    return NextResponse.json({ view }, { status: 201 });
  });
}
