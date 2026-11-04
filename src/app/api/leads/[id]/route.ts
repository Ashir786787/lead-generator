import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getLeadDetail } from "@/lib/data/leads";
import { bulkArchive, updateLead } from "@/lib/data/mutations";
import { PIPELINE_STATUSES } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(PIPELINE_STATUSES).optional(),
  notes: z.string().max(20_000).nullable().optional(),
  followUpAt: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.")
    .nullable()
    .optional(),
  doNotContact: z.boolean().optional(),
  ownerId: z.string().max(100).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    return NextResponse.json(await getLeadDetail(ctx, id));
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    const patch = patchSchema.parse(await request.json());
    await updateLead(ctx, id, patch);
    return NextResponse.json({ ok: true, detail: await getLeadDetail(ctx, id) });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    const archived = await bulkArchive(ctx, [id]);
    return NextResponse.json({ archived });
  });
}
