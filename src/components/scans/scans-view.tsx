"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleSlash,
  Clock,
  Globe2,
  Loader2,
  Radar,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { ScanJobSummary } from "@/lib/client/types";
import type { ScanSummary } from "@/lib/client/types";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { EmptyState, PageHeader, StatCard } from "@/components/page";
import { InlineAlert } from "@/components/form";
import { ScanOutcomeBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const FILTERS = [
  { value: "all", label: "All scans" },
  { value: "active", label: "Queued or running" },
  { value: "success", label: "Checked successfully" },
  { value: "review", label: "Needs a manual look" },
  { value: "failed", label: "Failed" },
] as const;

const REVIEW_OUTCOMES = new Set([
  "partial",
  "blocked_by_robots",
  "unreachable",
  "timeout",
  "tls_error",
  "non_html",
  "rejected_url",
  "error",
]);

export function ScansView({ initial, initialSummary }: { initial: ScanJobSummary[]; initialSummary: ScanSummary }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]["value"]>("all");
  const [cancelling, setCancelling] = React.useState<string | null>(null);

  const scansQuery = useQuery({
    queryKey: ["scans"],
    queryFn: () => apiFetch<{ items: ScanJobSummary[]; summary: ScanSummary }>("/api/scans"),
    initialData: { items: initial, summary: initialSummary },
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((job) => job.status === "queued" || job.status === "processing") ? 3000 : false;
    },
  });

  const scans = scansQuery.data.items;
  const summary = scansQuery.data.summary;
  const filtered = scans.filter((job) => {
    if (filter === "active") return job.status === "queued" || job.status === "processing";
    if (filter === "success") return job.outcome === "success";
    if (filter === "review") return job.outcome !== null && REVIEW_OUTCOMES.has(job.outcome);
    if (filter === "failed") return job.outcome !== null && job.outcome !== "partial" && job.outcome !== "success";
    return true;
  });

  async function cancel(id: string) {
    setCancelling(id);
    try {
      await apiFetch(`/api/scans/${id}/cancel`, { method: "POST", body: JSON.stringify({}) });
      toast.success("Scan cancelled.");
      await scansQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["lead"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setCancelling(null);
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Website research"
        title="Website scans"
        description="Public page inspections that respect robots.txt. Failed or incomplete checks stay labelled as such — they never masquerade as a negative result."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void scansQuery.refetch()}>
              <RefreshCw /> Refresh
            </Button>
            <Button asChild>
              <Link href="/leads?hasWebsite=true&sort=last_checked_desc">
                <Radar /> Queue more scans
              </Link>
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Queued" value={formatNumber(summary.queued)} icon={<Clock />} hint="Waiting to start" />
        <StatCard label="Running" value={formatNumber(summary.running)} icon={<Loader2 />} hint="Pages being inspected" />
        <StatCard
          label="Needs manual review"
          value={formatNumber(summary.needsReview)}
          icon={<ShieldAlert />}
          tone="warning"
          hint="Incomplete, blocked or failed checks"
        />
        <StatCard
          label="Never checked"
          value={formatNumber(summary.neverChecked)}
          icon={<Globe2 />}
          hint="Leads with a website but no completed scan"
        />
      </div>

      <div className="mb-4">
        <InlineAlert tone="info" title="How to read scan results">
          <strong>Detected</strong> means a chat widget was found on a checked page. <strong>Not detected in checked
          pages</strong> is not proof of absence. <strong>Scan incomplete</strong> and <strong>failed</strong> outcomes
          are never treated as “no chatbot”.
        </InlineAlert>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
            className="h-9 w-52"
            aria-label="Filter scans"
          >
            {FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {scans.length} shown
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Last 50 requests · auto-refresh while active</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Radar className="size-5" />}
          title={scans.length === 0 ? "No scans requested yet" : "No scans match this filter"}
          description={
            scans.length === 0
              ? "Select leads with a website and queue a scan from the leads table or a lead page."
              : "Try a different filter to see the other scan requests."
          }
          actions={
            scans.length === 0 ? (
              <Button asChild>
                <Link href="/leads?hasWebsite=true&sort=last_checked_desc">Browse leads with websites</Link>
              </Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => setFilter("all")}>
                Clear filter
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <ul className="divide-y divide-border/70">
            {filtered.map((job) => {
              const active = job.status === "queued" || job.status === "processing";
              const percent = job.pagesTotal > 0 ? Math.round((job.pagesDone / job.pagesTotal) * 100) : job.progress;
              return (
                <li key={job.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <Link href={`/leads/${job.businessId}`} className="truncate text-sm font-medium hover:underline">
                      {job.businessName ?? "Lead"}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Requested {relativeTime(job.createdAt)}
                      {job.finishedAt ? ` · finished ${relativeTime(job.finishedAt)}` : ""}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={
                        job.status === "completed"
                          ? "success"
                          : job.status === "failed"
                            ? "danger"
                            : job.status === "cancelled"
                              ? "muted"
                              : "info"
                      }
                      className="capitalize"
                    >
                      {active ? <Loader2 className="size-3 animate-spin" /> : job.status === "completed" ? <ShieldCheck className="size-3" /> : null}
                      {job.status}
                    </Badge>
                    {job.outcome ? <ScanOutcomeBadge outcome={job.outcome} /> : null}
                  </div>

                  <div className="min-w-0">
                    {active ? (
                      <div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {job.pagesDone}/{job.pagesTotal || "?"} pages · {job.progress}%
                        </p>
                      </div>
                    ) : (
                      <p className="truncate text-xs text-muted-foreground" title={formatDateTime(job.finishedAt ?? job.createdAt)}>
                        {job.pagesDone} page{job.pagesDone === 1 ? "" : "s"} checked
                      </p>
                    )}
                    {job.error ? <p className="mt-0.5 line-clamp-2 text-[11px] text-destructive">{job.error}</p> : null}
                  </div>

                  <div className="flex items-center gap-1.5 sm:justify-end">
                    {active ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void cancel(job.id)}
                        disabled={cancelling === job.id}
                      >
                        {cancelling === job.id ? <Loader2 className="animate-spin" /> : <CircleSlash />} Cancel
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/leads/${job.businessId}`}>Open lead</Link>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
