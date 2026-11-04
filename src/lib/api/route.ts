import type { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/errors";

/** Every API route funnels unexpected errors through this single shape. */
export async function apiRoute(
  handler: () => Promise<Response | NextResponse>,
): Promise<Response | NextResponse> {
  try {
    return await handler();
  } catch (error) {
    return errorResponse(error);
  }
}
