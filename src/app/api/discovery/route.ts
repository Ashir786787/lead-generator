import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import {
  createSavedSearch,
  listSavedSearches,
  markSavedSearchRun,
  providerStatuses,
  runDiscovery,
} from "@/lib/discovery/service";
import { CATEGORY_KEYS } from "@/lib/score/types";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { listImports } from "@/lib/import/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const searchSchema = z.object({
  provider: z.enum(["osm", "google_places"]),
  country: z.string().trim().min(1, "Enter the country.").max(120),
  city: z.string().trim().min(1, "Enter the city.").max(120),
  categories: z.array(z.enum(CATEGORY_KEYS)).min(1, "Choose at least one category.").max(8),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  saveSearch: z.boolean().optional(),
  savedSearchId: z.string().uuid().optional(),
  enabled: z.boolean().optional(),
});

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const [saved, imports] = await Promise.all([listSavedSearches(ctx), listImports(ctx)]);
    return NextResponse.json({
      providers: providerStatuses(),
      savedSearches: saved,
      recent: imports.filter((item) => item.origin === "discovery").slice(0, 8),
      categories: CATEGORY_KEYS,
    });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`discovery:${ctx.user.id}`, 6, 60_000);
    const body = searchSchema.parse(await request.json());
    const result = await runDiscovery(ctx, {
      provider: body.provider,
      country: body.country,
      city: body.city,
      categories: body.categories,
      limit: body.limit,
    });
    if (body.saveSearch) {
      await createSavedSearch(ctx, body);
    }
    if (body.savedSearchId) await markSavedSearchRun(ctx, body.savedSearchId);
    return NextResponse.json({ result, providers: providerStatuses() });
  });
}
