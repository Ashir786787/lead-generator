"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Check,
  Copy,
  GitMerge,
  History,
  Loader2,
  MapPin,
  Merge,
  Phone,
  Mail,
  Globe2,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { DuplicatePair } from "@/lib/client/types";
import { formatNumber } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/page";
import { InlineAlert } from "@/components/form";
import { StatusBadge, ScoreBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    same_phone: "Same phone number",
    same_website: "Same website",
    name_and_address: "Name and address are close",
    same_name: "Very similar name",
    nearby_and_similar: "Nearby with a similar name",
    identical_source_id: "Same source record",
  };
  return labels[reason] ?? reason.replace(/_/g, " ");
}

export function DuplicatesView({ initial }: { initial: DuplicatePair[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [undoing, setUndoing] = React.useState(false);

  const pairsQuery = useQuery({
    queryKey: ["duplicates"],
    queryFn: () => apiFetch<{ items: DuplicatePair[] }>("/api/duplicates"),
    initialData: { items: initial },
  });

  const pairs = pairsQuery.data.items;

  async function refresh() {
    await pairsQuery.refetch();
    await queryClient.invalidateQueries({ queryKey: ["leads"] });
    await queryClient.invalidateQueries({ queryKey: ["lead-facets"] });
    router.refresh();
  }

  async function resolve(pair: DuplicatePair, action: "merge" | "keep_separate" | "skip", keep?: "a" | "b") {
    if (action === "merge" && !window.confirm(`Merge these two records and keep “${keep === "b" ? pair.b.name : pair.a.name}”? You can undo the last merge.`)) {
      return;
    }
    setPendingId(pair.id);
    try {
      await apiFetch(`/api/duplicates/${pair.id}`, {
        method: "POST",
        body: JSON.stringify({ action, keep }),
      });
      toast.success(
        action === "merge"
          ? "Records merged. Outcomes and notes were preserved."
          : action === "keep_separate"
            ? "Kept as two separate businesses."
            : "Skipped for now.",
      );
      await refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPendingId(null);
    }
  }

  async function undo() {
    setUndoing(true);
    try {
      const result = await apiFetch<{ undone: boolean; message?: string }>("/api/duplicates/undo", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (result.undone) {
        toast.success("The last merge was undone.");
        await refresh();
      } else {
        toast.info(result.message ?? "There is no merge to undo.");
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Data quality"
        title="Possible duplicates"
        description="Pairs detected while importing or discovering. Merging keeps notes, tags, contact evidence and outcomes — and the last merge can be undone."
        actions={
          <Button type="button" variant="outline" onClick={() => void undo()} disabled={undoing}>
            {undoing ? <Loader2 className="animate-spin" /> : <History />} Undo last merge
          </Button>
        }
      />

      <div className="mb-5">
        <InlineAlert tone="info" title="Why these appear">
          The app only suggests a merge when strong signals agree. Pairs with weaker signals wait here for you instead of
          being merged automatically. Nothing is ever deleted by a merge.
        </InlineAlert>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Awaiting review</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(pairs.length)}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Merge policy</p>
          <p className="mt-1 text-sm font-semibold">Review before merge</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Undo is available</p>
        </div>
      </div>

      {pairs.length === 0 ? (
        <EmptyState
          icon={<Check className="size-5" />}
          title="No possible duplicates waiting"
          description="Imports and discovery runs will add pairs here when strong signals disagree or need a human decision."
          actions={
            <Button asChild variant="outline">
              <Link href="/leads">Back to leads</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {pairs.map((pair) => {
            const busy = pendingId === pair.id;
            return (
              <section key={pair.id} className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/35 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Copy className="size-4 text-warning" />
                    <span className="text-sm font-semibold">{Math.round(pair.similarity * 100)}% match</span>
                    {pair.reasons.map((reason) => (
                      <Badge key={reason} variant="outline">
                        {reasonLabel(reason)}
                      </Badge>
                    ))}
                    {pair.distanceM !== null ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="size-3" /> {Math.round(pair.distanceM)} m apart
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void resolve(pair, "keep_separate")}
                      disabled={busy}
                    >
                      <ArrowLeftRight /> Keep both
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void resolve(pair, "skip")} disabled={busy}>
                      Skip
                    </Button>
                  </div>
                </div>

                <div className="grid divide-y divide-border/70 md:grid-cols-2 md:divide-x md:divide-y-0">
                  {[pair.a, pair.b].map((lead, index) => {
                    const side = index === 0 ? "a" : "b";
                    return (
                      <div key={lead.id} className="flex flex-col gap-3 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link href={`/leads/${lead.id}`} className="truncate text-sm font-semibold hover:underline">
                              {lead.name}
                            </Link>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {[lead.category, lead.city].filter(Boolean).join(" · ") || "No category or city"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <ScoreBadge score={lead.latestScore} />
                            <StatusBadge status={lead.status as Parameters<typeof StatusBadge>[0]["status"]} />
                          </div>
                        </div>

                        <ul className="space-y-1.5 text-xs text-muted-foreground">
                          {lead.phone ? (
                            <li className="flex items-center gap-1.5">
                              <Phone className="size-3.5 shrink-0" /> {lead.phone}
                            </li>
                          ) : null}
                          {lead.email ? (
                            <li className="flex items-center gap-1.5 truncate">
                              <Mail className="size-3.5 shrink-0" /> {lead.email}
                            </li>
                          ) : null}
                          {lead.websiteHost ? (
                            <li className="flex items-center gap-1.5 truncate">
                              <Globe2 className="size-3.5 shrink-0" /> {lead.websiteHost}
                            </li>
                          ) : null}
                          {lead.street ? (
                            <li className="flex items-center gap-1.5">
                              <MapPin className="size-3.5 shrink-0" /> {lead.street}
                            </li>
                          ) : null}
                        </ul>

                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void resolve(pair, "merge", side)}
                            disabled={busy}
                          >
                            {busy ? <Loader2 className="animate-spin" /> : <Merge />}
                            Keep this record
                          </Button>
                          <Button asChild size="sm" variant="ghost">
                            <Link href={`/leads/${lead.id}`}>Open</Link>
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-start gap-2 border-t border-border/70 px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" />
                  Merging keeps the selected record and archives the other, moving its notes, tags, sources and scan
                  outcome across. Review the details first if you are unsure.
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
        <GitMerge className="size-3.5" /> Merge suggestions come from your own records, not from outside data.
      </div>
    </div>
  );
}
