import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/lib/logger";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Some fields are invalid.",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 },
    );
  }
  const errorId = crypto.randomUUID();
  logger.error({ err: error, errorId }, "Unhandled API error");
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong on our side. Please retry.",
        details: { errorId },
      },
    },
    { status: 500 },
  );
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function notFound(message = "Not found"): ApiError {
  return new ApiError(404, "NOT_FOUND", message);
}

export function forbidden(message = "You do not have access to this resource."): ApiError {
  return new ApiError(403, "FORBIDDEN", message);
}

export function unauthorized(message = "Please sign in to continue."): ApiError {
  return new ApiError(401, "UNAUTHORIZED", message);
}

export function conflict(message: string): ApiError {
  return new ApiError(409, "CONFLICT", message);
}

export function badRequest(message: string, details?: unknown): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, details);
}

/** Small namespace so route helpers read naturally (`api.badRequest`). */
export const api = { notFound, forbidden, unauthorized, conflict, badRequest };
