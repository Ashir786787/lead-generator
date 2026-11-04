import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { setContactVerified } from "@/lib/data/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ verified: z.boolean() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> },
) {
  return apiRoute(async () => {
    const { contactId } = await params;
    const ctx = await getWorkspaceContext();
    const body = schema.parse(await request.json());
    await setContactVerified(ctx, contactId, body.verified);
    return NextResponse.json({ ok: true });
  });
}
