"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RowSelectionState } from "@tanstack/react-table";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Radar,
  SearchX,
  Tag,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, downloadExport, errorMessage, saveBlob } from "@/lib/client/api";
import { useDebouncedValue } from "@/lib/client/hooks";
import type { LeadFacets, LeadListResult, SavedView } from "@/lib/client/types";
import {
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  type PipelineStatus,
} from "@/lib/constants";
import { formatNumber } from "@/lib/utils";
import { PageHeader, EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LeadFilters } from "@/components/leads/lead-filters";
import { LeadTable } from "@/components/leads/lead-table";
import { NewLeadDialog } from "@/components/leads/new-lead-dialog";
import { ExportDialog } from "@/components/leads/export-dialog";
import { ManageViewsDialog, SaveViewDialog } from "@/components/leads/view-dialogs";
import {
  DEFAULT_FILTERS,
  filtersFromParams,
  filtersToParams,
  filtersToRecord,
  queryForApi,
  type LeadFilterState,
} from "@/components/leads/filter-state";

interface FacetsResponse {
  facets: LeadFacets;
  overview: unknown;
}

export function LeadsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const initialParams = React.useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams]);
  const [filters, setFilters] = React.useState<LeadFilterState>(() => filtersFromParams(initialParams));
  const [deferredQ, setDeferredQ] = React.useState(filters.q);
  const [selected, setSelected] = React.useState<RowSelectionState>({});
  const [newOpen, setNewOpen] = React.useState(initialParams.get("new") === "1");
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportQuery, setExportQuery] = React.useState<Record<string, string> | null>(null);
  const [saveViewOpen, setSaveViewOpen] = React.useState(false);
  const [manageViewsOpen, setManageViewsOpen] = React.useState(false);
  const [tagOpen, setTagOpen] = React.useState(false);
  const [tagValue, setTagValue] = React.useState("");
  const [bulkPending, setBulkPending] = React.useState(false);

  const debouncedQ = useDebouncedValue(filters.q, 350);
  React.useEffect(() => {
    setDeferredQ(debouncedQ);
  }, [debouncedQ]);

  const effectiveFilters = React.useMemo(
    () => ({ ...filters, q: deferredQ }),
    [filters, deferredQ],
  );
  const apiQuery = queryForApi(effectiveFilters);

  React.useEffect(() => {
    const params = filtersToParams(effectiveFilters);
    const next = params.toString();
    const current = window.location.search.replace(/^\?/, "");
    if (next !== current) {
      router.replace(next ? `/leads?${next}` : "/leads", { scroll: false });
    }
  }, [effectiveFilters, router]);

  React.useEffect(() => {
    setSelected({});
  }, [apiQuery]);

  React.useEffect(() => {
    const listener = () => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["lead-facets"] });
    };
    window.addEventListener("lf:live", listener);
    return () => window.removeEventListener("lf:live", listener);
  }, [queryClient]);

  const leadsQuery = useQuery({
    queryKey: ["leads", apiQuery],
    queryFn: () => apiFetch<LeadListResult>(`/api/leads?${apiQuery}`),
    placeholderData: (previous) => previous,
  });

  const facetsQuery = useQuery({
    queryKey: ["lead-facets"],
    queryFn: () => apiFetch<FacetsResponse>("/api/leads/facets"),
  });

  const viewsQuery = useQuery({
    queryKey: ["saved-views"],
    queryFn: () => apiFetch<{ items: SavedView[] }>("/api/saved-views"),
  });

  const data = leadsQuery.data;
  const total = data?.total ?? 0;
  const page = effectiveFilters.page;
  const pageSize = effectiveFilters.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedIds = Object.entries(selected)
    .filter(([, value]) => value)
    .map(([id]) => id);

  function updateFilters(patch: Partial<LeadFilterState>) {
    setFilters((value) => ({
      ...value,
      ...patch,
      page: patch.page ?? (patch.q !== undefined ? 1 : value.page),
    }));
  }

  function applyView(view: SavedView) {
    const params = new URLSearchParams(view.query);
    setFilters(filtersFromParams(params));
    setDeferredQ(params.get("q") ?? "");
    toast.success(`Applied “${view.name}”.`);
  }

  async function runBulk(action: "status" | "tag" | "archive" | "scan", payload: Record<string, unknown> = {}) {
    if (!selectedIds.length) return;
    setBulkPending(true);
    try {
      const result = await apiFetch<{
        affected?: number;
        results?: Array<{ scanJobId: string | null; reason?: string; outcome?: string }>;
        inline?: boolean;
      }>(
        "/api/leads/bulk",
        {
          method: "POST",
          body: JSON.stringify({ action, ids: selectedIds, ...payload }),
        },
      );
      if (action === "scan") {
        const queued = result.results?.filter((item) => item.scanJobId).length ?? 0;
        const skipped = (result.results?.length ?? 0) - queued;
        const needReview = result.results?.filter((item) => item.outcome && item.outcome !== "success").length ?? 0;
        toast.success(
          queued
            ? `Scanned ${queued} website${queued === 1 ? "" : "s"}${needReview ? `, ${needReview} need review` : ""}${skipped ? `, skipped ${skipped}` : ""}.`
            : "No scans were run. Check that these leads have websites.",
        );
      } else if (action === "archive") {
        toast.success(`Archived ${result.affected ?? selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}.`);
      } else {
        toast.success(`Updated ${result.affected ?? selectedIds.length} lead${selectedIds.length === 1 ? "" : "s"}.`);
      }
      setSelected({});
      setTagOpen(false);
      setTagValue("");
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["lead-facets"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBulkPending(false);
    }
  }

  async function scanOne(leadId: string) {
    try {
      const result = await apiFetch<{
        results: Array<{ scanJobId: string | null; reason?: string; outcome?: string }>;
      }>(`/api/leads/${leadId}/scan`, { method: "POST", body: JSON.stringify({}) });
      const queued = result.results[0];
      if (queued?.scanJobId) {
        if (queued.outcome === "success") toast.success("Website scan completed.");
        else if (queued.outcome === "cancelled") toast.info("Scan cancelled.");
        else if (queued.outcome) toast.warning(`Website scan finished with “${queued.outcome}”. Check the scan details.`);
        else toast.success("Website scan finished.");
      } else if (queued?.reason === "no_website") toast.error("This lead has no website to scan.");
      else if (queued?.reason === "already_running") toast.info("A scan is already running for this lead.");
      else toast.error("Could not queue this scan.");
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function exportSelected() {
    if (!selectedIds.length) return;
    try {
      const result = await downloadExport({
        query: { ids: selectedIds.join(",") },
        includeNotes: false,
        includeDnc: true,
      });
      saveBlob(result.blob, result.filename);
      toast.success(`Exported ${result.rowCount} selected leads.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  const facets = facetsQuery.data?.facets ?? null;
  const savedViews = viewsQuery.data?.items ?? [];
  const activeQuery = filtersToRecord(effectiveFilters);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Lead workspace"
        title="Leads"
        description="Every business belongs to this workspace. Filter, qualify and inspect public pages before making contact yourself."
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setExportQuery(null);
                setExportOpen(true);
              }}
            >
              <Download /> Export
            </Button>
            <Button type="button" onClick={() => setNewOpen(true)}>
              <Plus /> Add lead
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat label="Active" value={formatNumber(data?.workspaceStats.total ?? 0)} />
        <MiniStat label="With email" value={formatNumber(data?.workspaceStats.withEmail ?? 0)} />
        <MiniStat label="Possible duplicates" value={formatNumber(data?.workspaceStats.duplicates ?? 0)} />
        <MiniStat label="Overdue follow-ups" value={formatNumber(data?.workspaceStats.overdueFollowUps ?? 0)} />
      </div>

      <div className="space-y-3">
        <LeadFilters
          filters={filters}
          facets={facets}
          savedViews={savedViews}
          total={total}
          onChange={updateFilters}
          onApplyView={applyView}
          onSaveView={() => setSaveViewOpen(true)}
          onManageViews={() => setManageViewsOpen(true)}
        />

        {selectedIds.length ? (
          <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-card p-2.5 shadow-md">
            <span className="mr-1 text-sm font-medium">
              {selectedIds.length} selected
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={bulkPending}>
                  Change stage
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
                <DropdownMenuLabel>Set pipeline stage</DropdownMenuLabel>
                <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                {PIPELINE_STATUSES.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onSelect={() => void runBulk("status", { status: status satisfies PipelineStatus })}
                  >
                    {PIPELINE_STATUS_LABELS[status]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" variant="outline" size="sm" onClick={() => setTagOpen(true)} disabled={bulkPending}>
              <Tag /> Add tag
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void runBulk("scan")} disabled={bulkPending}>
              {bulkPending ? <Loader2 className="animate-spin" /> : <Radar />} Queue scans
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void exportSelected()}>
              <Download /> Export selected
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void runBulk("archive")}
              disabled={bulkPending}
            >
              <Archive /> Archive
            </Button>
            <Button type="button" variant="ghost" size="iconSm" onClick={() => setSelected({})} aria-label="Clear selection">
              <X />
            </Button>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {leadsQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-20 text-sm text-muted-foreground">
              <Loader2 className="animate-spin" /> Loading leads…
            </div>
          ) : leadsQuery.isError ? (
            <div className="px-4 py-16 text-center">
              <p className="text-sm text-destructive">Could not load leads.</p>
              <p className="mt-1 text-xs text-muted-foreground">{errorMessage(leadsQuery.error)}</p>
              <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void leadsQuery.refetch()}>
                Retry
              </Button>
            </div>
          ) : data && data.items.length > 0 ? (
            <>
              <LeadTable
                leads={data.items}
                selected={selected}
                onSelectedChange={setSelected}
                sort={effectiveFilters.sort}
                onSortChange={(sort) => updateFilters({ sort, page: 1 })}
                onScan={(lead) => void scanOne(lead.id)}
                onArchive={(lead) => {
                  setSelected({ [lead.id]: true });
                  toast.info("Select archive from the bulk bar to confirm.");
                }}
                canArchive
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPage={(next) => updateFilters({ page: next })}
                onPageSize={(size) => updateFilters({ pageSize: size, page: 1 })}
              />
            </>
          ) : (
            <EmptyState
              icon={activeFilterCountLocal(effectiveFilters) > 0 ? <SearchX className="size-5" /> : <Users className="size-5" />}
              title={activeFilterCountLocal(effectiveFilters) > 0 ? "No leads match these filters" : "No leads yet"}
              description={
                activeFilterCountLocal(effectiveFilters) > 0
                  ? "Try widening the filters or clearing the search."
                  : "Import a list you have rights to use, discover live businesses from OpenStreetMap, or add one manually."
              }
              actions={
                activeFilterCountLocal(effectiveFilters) > 0 ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setFilters({ ...DEFAULT_FILTERS })}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <>
                    <Button asChild>
                      <Link href="/imports">Import a list</Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/discovery">Discover businesses</Link>
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setNewOpen(true)}>
                      <Plus /> Add manually
                    </Button>
                  </>
                )
              }
              className="rounded-none border-0"
            />
          )}
        </div>
      </div>

      <NewLeadDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        onCreated={(leadId) => router.push(`/leads/${leadId}`)}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        query={exportQuery ?? activeQuery}
      />
      <SaveViewDialog open={saveViewOpen} onOpenChange={setSaveViewOpen} query={activeQuery} />
      <ManageViewsDialog
        open={manageViewsOpen}
        onOpenChange={setManageViewsOpen}
        views={savedViews}
        onApply={applyView}
      />

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a tag to {selectedIds.length} leads</DialogTitle>
            <DialogDescription>
              Tags are shared within this workspace. An existing tag with the same name is reused.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
              placeholder="e.g. priority"
              maxLength={40}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTagOpen(false)} disabled={bulkPending}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void runBulk("tag", { tag: tagValue.trim() })}
              disabled={bulkPending || !tagValue.trim()}
            >
              {bulkPending ? <Loader2 className="animate-spin" /> : <Tag />}
              Add tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border/70 px-4 py-3 text-xs text-muted-foreground sm:flex-row">
      <span>
        Showing {from}–{to} of {formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <select
          aria-label="Rows per page"
          className="h-8 rounded-md border border-input bg-card px-2 text-xs"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          <option value={25}>25 per page</option>
          <option value={50}>50 per page</option>
          <option value={100}>100 per page</option>
        </select>
        <Button type="button" variant="outline" size="iconSm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center font-medium text-foreground">
          {page} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="iconSm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function activeFilterCountLocal(filters: LeadFilterState): number {
  let count = 0;
  if (filters.q.trim()) count++;
  if (filters.city) count++;
  if (filters.status) count++;
  if (filters.category) count++;
  if (filters.minScore) count++;
  if (filters.hasWebsite) count++;
  if (filters.hasEmail) count++;
  if (filters.hasWhatsapp) count++;
  if (filters.scanOutcome) count++;
  if (filters.chatbot) count++;
  if (filters.followUp) count++;
  if (filters.includeArchived) count++;
  if (filters.includeDnc) count++;
  return count;
}
