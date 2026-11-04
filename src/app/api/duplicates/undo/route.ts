import { NextResponse } from "next/server";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import { undoLastMerge } from "@/lib/dedupe/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const result = await undoLastMerge(ctx);
    if (!result) return NextResponse.json({ undone: false, message: "There is no merge to undo." });
    return NextResponse.json({ undone: true, ...result });
  });
}
