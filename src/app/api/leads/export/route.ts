import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { exportLeadsCsv } from "@/lib/export/csv";
import { checkRateLimit } from "@/lib/api/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  query: z.record(z.string(), z.string()).default({}),
  includeNotes: z.boolean().default(false),
  includeDnc: z.boolean().default(false),
});

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    checkRateLimit(`export:${ctx.user.id}`, 10, 60_000);
    const body = schema.parse(await request.json().catch(() => ({})));
    const result = await exportLeadsCsv(ctx, body.query, {
      includeNotes: body.includeNotes,
      includeDnc: body.includeDnc,
    });
    return new Response(result.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Cache-Control": "no-store",
        "X-Row-Count": String(result.rowCount),
      },
    });
  });
}
