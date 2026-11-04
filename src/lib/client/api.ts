export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(input, { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    let body: ErrorBody = {};
    try {
      body = (await response.json()) as ErrorBody;
    } catch {
      /* non-JSON error */
    }
    throw new ApiClientError(
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
      body.error?.message ?? "Something went wrong. Please retry.",
      body.error?.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please retry.";
}

export async function downloadExport(body: {
  query: Record<string, string>;
  includeNotes: boolean;
  includeDnc: boolean;
}): Promise<{ blob: Blob; filename: string; rowCount: number }> {
  const response = await fetch("/api/leads/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = "Could not build this export.";
    try {
      const parsed = (await response.json()) as ErrorBody;
      message = parsed.error?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiClientError(response.status, "EXPORT_FAILED", message);
  }
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const blob = await response.blob();
  return {
    blob,
    filename: match?.[1] ?? "leads.csv",
    rowCount: Number(response.headers.get("X-Row-Count") ?? 0),
  };
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
