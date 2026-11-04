import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { importErrorRows } from "@/lib/import/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return apiRoute(async () => {
    const { id } = await params;
    const ctx = await getWorkspaceContext();
    const rows = await importErrorRows(ctx, id);
    const lines = [["Row", "Reason", "Raw record"].map(cell).join(",")];
    for (const row of rows) {
      lines.push([row.rowNumber, row.reason, row.raw ? JSON.stringify(row.raw) : ""].map(cell).join(","));
    }
    return new Response(`${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="import-errors-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  });
}
