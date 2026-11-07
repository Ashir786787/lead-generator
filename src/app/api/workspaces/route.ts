import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { apiRoute } from "@/lib/api/route";
import { getWorkspaceContext } from "@/lib/auth/session";
import {
  addWorkspaceMember,
  getWorkspaceSettings,
  switchWorkspace,
  updateWorkspaceSettings,
} from "@/lib/data/workspace";
import { WORKSPACE_COOKIE } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), workspaceId: z.string().uuid() }),
  z.object({
    action: z.literal("add_member"),
    email: z.string().trim().email().max(320),
    password: z.string().min(8, "Use at least 8 characters.").max(128),
    name: z.string().trim().max(120).optional(),
  }),
]);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  countryNotes: z.record(z.string(), z.string().max(500)).optional(),
});

export async function GET() {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    return NextResponse.json({
      settings: await getWorkspaceSettings(ctx),
      workspaces: ctx.workspaces,
      activeWorkspaceId: ctx.workspaceId,
      user: ctx.user,
      role: ctx.role,
    });
  });
}

export async function PATCH(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const patch = patchSchema.parse(await request.json());
    await updateWorkspaceSettings(ctx, patch);
    return NextResponse.json({ settings: await getWorkspaceSettings(ctx) });
  });
}

export async function POST(request: Request) {
  return apiRoute(async () => {
    const ctx = await getWorkspaceContext();
    const body = postSchema.parse(await request.json());
    if (body.action === "switch") {
      await switchWorkspace(ctx, body.workspaceId);
      const cookieStore = await cookies();
      cookieStore.set(WORKSPACE_COOKIE, body.workspaceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
      return NextResponse.json({ ok: true, workspaceId: body.workspaceId });
    }
    const member = await addWorkspaceMember(ctx, {
      email: body.email,
      password: body.password,
      name: body.name,
    });
    return NextResponse.json({ member }, { status: 201 });
  });
}
