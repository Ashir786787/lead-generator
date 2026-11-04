import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { geocodePlace } from "@/lib/discovery/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z
  .string()
  .trim()
  .min(2, "Enter a city or place name.")
  .max(220, "Keep the place name under 220 characters.");

export async function GET(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`discovery-geocode:${ctx.user.id}`, 20, 60_000);
    const raw = new URL(request.url).searchParams.get("q") ?? "";
    const query = querySchema.parse(raw);
    const results = await geocodePlace(query);
    return NextResponse.json({
      results,
      attribution: "© OpenStreetMap contributors (ODbL), geocoding by Nominatim",
    });
  });
}
