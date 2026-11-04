"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { ImportDetail } from "@/lib/client/types";
import { IMPORT_FIELD_LABELS } from "@/lib/client/import-labels";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { PageHeader, SectionCard } from "@/components/page";
import { InlineAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImportStatusBadge } from "@/components/imports/imports-view";

const COUNTERS: Array<{ key: keyof ImportDetail; label: string; tone?: "positive" | "warning" | "danger" }> = [
  { key: "validCount", label: "Valid rows" },
  { key: "newCount", label: "New leads", tone: "positive" },
  { key: "mergedCount", label: "Merged automatically" },
  { key: "duplicateCount", label: "Duplicates" },
  { key: "reviewCount", label: "Sent to review", tone: "warning" },
  { key: "skippedCount", label: "Skipped" },
  { key: "errorCount", label: "Errors", tone: "danger" },
];

export function ImportDetailView({ initial, timezone }: { initial: ImportDetail; timezone: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pending, setPending] = React.useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["import", initial.id],
    queryFn: () => apiFetch<ImportDetail>(`/api/imports/${initial.id}`),
    initialData: initial,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 2000 : false;
    },
  });
  const detail = detailQuery.data;
  const active = detail.status === "queued" || detail.status === "processing";

  React.useEffect(() => {
    if (active) return;
    void queryClient.invalidateQueries({ queryKey: ["imports"] });
    void queryClient.invalidateQueries({ queryKey: ["leads"] });
  }, [active, queryClient]);

  async function cancel() {
    setPending("cancel");
    try {
      await apiFetch(`/api/imports/${detail.id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Import cancelled.");
      await detailQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function retry() {
    setPending("retry");
    try {
      const result = await apiFetch<{ queued: boolean; existingJobId?: string }>(`/api/imports/${detail.id}/start`, {
        method: "POST",
        body: JSON.stringify({ mapping: detail.mapping, force: true }),
      });
      if (result.existingJobId) toast.info("A previous completed import already used this file and mapping.");
      else toast.success("Import re-queued.");
      await detailQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this import record? The uploaded file is removed. Leads that were already created stay in your workspace.")) {
      return;
    }
    setPending("delete");
    try {
      await apiFetch(`/api/imports/${detail.id}`, { method: "DELETE" });
      toast.success("Import record deleted.");
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      router.push("/imports");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(null);
    }
  }

  return (
    <div className="animate-rise">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/imports" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Imports
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{detail.filename}</span>
      </div>

      <PageHeader
        eyebrow={detail.origin === "discovery" ? "Discovery run" : "File import"}
        title={detail.filename}
        description={`Started ${formatDateTime(detail.createdAt, timezone)} · ${detail.origin === "discovery" ? "live source" : "uploaded file"}`}
        actions={
          <>
            {detail.errorCount > 0 ? (
              <Button asChild variant="outline">
                <a href={`/api/imports/${detail.id}/errors`} download>
                  <Download /> Error report
                </a>
              </Button>
            ) : null}
            {active ? (
              <Button type="button" variant="outline" onClick={() => void cancel()} disabled={pending !== null}>
                {pending === "cancel" ? <Loader2 className="animate-spin" /> : <XCircle />} Cancel
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => void retry()} disabled={pending !== null}>
                {pending === "retry" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => void remove()} disabled={pending !== null || active}>
              {pending === "delete" ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
            </Button>
          </>
        }
      />

      {detail.error ? (
        <div className="mb-5">
          <InlineAlert tone="danger" title="This import did not finish">
            {detail.error}
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard
            title="Progress"
            description={
              active
                ? "The worker is processing rows in the background. This page refreshes automatically."
                : detail.status === "completed"
                  ? "This import finished. Rows that needed a human decision are in duplicate review."
                  : "This import is not running."
            }
            actions={<ImportStatusBadge status={detail.status} />}
          >
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    {detail.processedRows} of {detail.rowCount || "?"} rows processed
                  </span>
                  <span className="font-medium tabular-nums">{detail.progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, detail.progress))}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {COUNTERS.map((counter) => {
                  const value = Number(detail[counter.key] ?? 0);
                  return (
                    <div key={counter.key} className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {counter.label}
                      </p>
                      <p
                        className={
                          counter.tone === "positive"
                            ? "mt-0.5 text-lg font-semibold tabular-nums text-success"
                            : counter.tone === "warning"
                              ? "mt-0.5 text-lg font-semibold tabular-nums text-warning"
                              : counter.tone === "danger"
                                ? "mt-0.5 text-lg font-semibold tabular-nums text-destructive"
                                : "mt-0.5 text-lg font-semibold tabular-nums"
                        }
                      >
                        {formatNumber(value)}
                      </p>
                    </div>
                  );
                })}
              </div>

              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Started</dt>
                  <dd className="mt-0.5">{detail.startedAt ? formatDateTime(detail.startedAt, timezone) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Finished</dt>
                  <dd className="mt-0.5">{detail.finishedAt ? formatDateTime(detail.finishedAt, timezone) : "—"}</dd>
                </div>
              </dl>

              {detail.duplicateFile ? (
                <InlineAlert tone="warning" title="Possible repeat import">
                  Another import in this workspace used the same file. Duplicate detection still protects your data, but
                  check that this run was intentional.
                </InlineAlert>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="Rows that could not be imported"
            description="Every rejected row is listed with its original record. Nothing is hidden."
          >
            {detail.errors.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border/70 text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Row</th>
                      <th className="py-2 pr-3 font-medium">Reason</th>
                      <th className="py-2 font-medium">Raw record</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {detail.errors.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">{row.rowNumber}</td>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-start gap-1.5 text-destructive">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {row.reason}
                          </span>
                        </td>
                        <td className="max-w-md py-2 font-mono text-[11px] text-muted-foreground">
                          <span className="line-clamp-2 break-all">
                            {row.raw ? JSON.stringify(row.raw) : "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {detail.errorCount > detail.errors.length ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Showing the first {detail.errors.length} of {formatNumber(detail.errorCount)} rows. Download the
                    error report for the complete list.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" /> No rows were rejected.
              </p>
            )}
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Column mapping" description="The mapping used for this import.">
            {Object.keys(detail.mapping).length ? (
              <dl className="space-y-2 text-sm">
                {Object.entries(detail.mapping).map(([field, column]) => (
                  <div key={field} className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">
                      {IMPORT_FIELD_LABELS[field as keyof typeof IMPORT_FIELD_LABELS] ?? field}
                    </dt>
                    <dd className="truncate text-right font-medium">{column}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">No mapping was recorded.</p>
            )}
          </SectionCard>

          <SectionCard title="Detected columns" description="As read from the file.">
            {detail.detectedColumns?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {detail.detectedColumns.map((column) => (
                  <Badge key={column} variant="outline">
                    {column}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No column metadata recorded.</p>
            )}
          </SectionCard>

          <SectionCard title="What happens next" description="Your data stays under your control.">
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                New businesses are added to this workspace with their source recorded.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                Strong matches merge automatically; uncertain pairs wait in duplicate review.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                No outreach is sent. You review and contact businesses yourself.
              </li>
            </ul>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link href="/leads">
                <FileSpreadsheet /> Open leads
              </Link>
            </Button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              {detail.finishedAt ? `Completed ${relativeTime(detail.finishedAt)}` : "Still in progress"}
            </p>
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
