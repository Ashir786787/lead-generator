import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { parseLeadQuery } from "@/lib/data/filters";
import { listLeads } from "@/lib/data/leads";
import { createManualLead } from "@/lib/data/manual";
import { getWorkspaceContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { PIPELINE_STATUSES } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dateish = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Enter a valid date.")
  .nullable()
  .optional();

const manualLeadSchema = z.object({
  name: z.string().trim().min(1, "Enter the business name.").max(200),
  category: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  phone: z.string().trim().max(60).nullable().optional(),
  email: z.string().trim().max(320).nullable().optional(),
  street: z.string().trim().max(240).nullable().optional(),
  area: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  status: z.enum(PIPELINE_STATUSES).optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  followUpAt: dateish,
  ownerId: z.string().trim().max(100).nullable().optional(),
  doNotContact: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});

export async function GET(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const query = parseLeadQuery(new URL(request.url).searchParams);
    const result = await listLeads(ctx, query);
    return NextResponse.json(result);
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`lead-create:${ctx.user.id}`, 60, 60_000);
    const body = manualLeadSchema.parse(await request.json());
    const result = await createManualLead(ctx, body);
    return NextResponse.json(result, { status: 201 });
  });
}
