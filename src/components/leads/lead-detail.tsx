"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  Archive,
  BadgeCheck,
  Building2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Clock,
  Copy,
  ExternalLink,
  Globe2,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  Radar,
  Save,
  ShieldCheck,
  StickyNote,
  Tag,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { LeadDetail, ScanJobSummary } from "@/lib/client/types";
import {
  CHATBOT_LABELS,
  PIPELINE_STATUSES,
  PIPELINE_STATUS_LABELS,
  SCAN_OUTCOME_LABELS,
  type ChatbotLabel,
  type PipelineStatus,
} from "@/lib/constants";
import { cn, formatDate, formatDateTime, isRecord, relativeTime } from "@/lib/utils";
import { InlineAlert } from "@/components/form";
import { PageHeader, SectionCard } from "@/components/page";
import { ChatbotBadge, ScanOutcomeBadge, ScoreBadge, SourceBadge, StatusBadge } from "@/components/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

interface ScoreComponentView {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
  withheld: boolean;
}

function scoreComponents(value: unknown): ScoreComponentView[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    key: String(item.key ?? ""),
    label: String(item.label ?? "Component"),
    points: Number(item.points ?? 0),
    max: Number(item.max ?? 0),
    reason: String(item.reason ?? ""),
    withheld: item.withheld === true,
  }));
}

function widgetList(value: unknown): Array<{ name: string; evidence: string; confidence: string; pageUrl?: string }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    name: String(item.name ?? "Chat widget"),
    evidence: String(item.evidence ?? ""),
    confidence: String(item.confidence ?? ""),
    pageUrl: typeof item.pageUrl === "string" ? item.pageUrl : undefined,
  }));
}

function pageList(value: unknown): Array<{ url: string; outcome: string; httpStatus: unknown; chatWidgets: unknown[]; error: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    url: String(item.url ?? ""),
    outcome: String(item.outcome ?? ""),
    httpStatus: item.httpStatus,
    chatWidgets: Array.isArray(item.chatWidgets) ? item.chatWidgets : [],
    error: item.error,
  }));
}

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const CONTACT_META: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: "Email", icon: Mail },
  phone: { label: "Phone", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: MessageSquare },
  social: { label: "Social", icon: ExternalLink },
  booking: { label: "Booking", icon: CalendarClock },
  contact_form: { label: "Contact form", icon: Mail },
  chat_widget: { label: "Chat widget", icon: MessageSquare },
};

export function LeadDetailView({ initial, timezone }: { initial: LeadDetail; timezone: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = React.useState<PipelineStatus>(initial.lead.status);
  const [notes, setNotes] = React.useState(initial.lead.notes ?? "");
  const [followUp, setFollowUp] = React.useState(toLocalInput(initial.lead.followUpAt));
  const [tagInput, setTagInput] = React.useState(initial.tags.map((tag) => tag.name).join(", "));
  const [doNotContact, setDoNotContact] = React.useState(initial.lead.doNotContact);
  const [saving, setSaving] = React.useState(false);
  const [scanning, setScanning] = React.useState(false);
  const [archiving, setArchiving] = React.useState(false);

  const detailQuery = useQuery({
    queryKey: ["lead", initial.lead.id],
    queryFn: () => apiFetch<LeadDetail>(`/api/leads/${initial.lead.id}`),
    initialData: initial,
  });
  const detail = detailQuery.data;

  const scansQuery = useQuery({
    queryKey: ["scan-jobs", initial.lead.id],
    queryFn: () => apiFetch<{ items: ScanJobSummary[] }>(`/api/scans?businessId=${initial.lead.id}`),
  });

  React.useEffect(() => {
    if (!detail) return;
    setStatus(detail.lead.status);
    setNotes(detail.lead.notes ?? "");
    setFollowUp(toLocalInput(detail.lead.followUpAt));
    setTagInput(detail.tags.map((tag) => tag.name).join(", "));
    setDoNotContact(detail.lead.doNotContact);
  }, [detail]);

  const lead = detail.lead;
  const activeScan = scansQuery.data?.items.find((job) => job.status === "queued" || job.status === "processing");

  async function patch(body: Record<string, unknown>, message: string) {
    try {
      const result = await apiFetch<{ detail: LeadDetail }>(`/api/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      queryClient.setQueryData(["lead", lead.id], result.detail);
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["lead-facets"] });
      toast.success(message);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function saveDetails() {
    setSaving(true);
    try {
      const tags = tagInput
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 20);
      const result = await apiFetch<{ detail: LeadDetail }>(`/api/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          notes,
          followUpAt: fromLocalInput(followUp),
          tags,
        }),
      });
      queryClient.setQueryData(["lead", lead.id], result.detail);
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast.success("Lead details saved.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: PipelineStatus) {
    setStatus(next);
    await patch({ status: next }, `Moved to ${PIPELINE_STATUS_LABELS[next]}.`);
  }

  async function changeDnc(next: boolean) {
    setDoNotContact(next);
    await patch({ doNotContact: next }, next ? "Marked as do not contact." : "Do-not-contact removed.");
  }

  async function queueScan() {
    setScanning(true);
    try {
      const result = await apiFetch<{
        results: Array<{ scanJobId: string | null; reason?: string; outcome?: string }>;
        inline?: boolean;
      }>(`/api/leads/${lead.id}/scan`, { method: "POST", body: JSON.stringify({}) });
      const item = result.results[0];
      if (item?.scanJobId && result.inline) {
        if (item.outcome === "success") toast.success("Website scan completed.");
        else if (item.outcome === "cancelled") toast.info("Scan cancelled.");
        else toast.warning(`Website scan finished with “${item.outcome ?? "unknown"}”. Check the scan details.`);
      } else if (item?.scanJobId) {
        toast.success("Website scan queued.");
      } else if (item?.reason === "no_website") toast.error("This lead has no website to scan.");
      else if (item?.reason === "already_running") toast.info("A scan is already running.");
      else toast.error("Could not queue this scan.");
      await scansQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setScanning(false);
    }
  }

  async function verifyContact(contactId: string, verified: boolean) {
    try {
      await apiFetch(`/api/leads/${lead.id}/contacts/${contactId}/verify`, {
        method: "POST",
        body: JSON.stringify({ verified }),
      });
      await detailQuery.refetch();
      toast.success(verified ? "Marked verified by you." : "Verification removed.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function archiveLead() {
    if (!window.confirm("Archive this lead? It can be restored from the archived filter.")) return;
    setArchiving(true);
    try {
      await apiFetch(`/api/leads/${lead.id}`, { method: "DELETE" });
      toast.success("Lead archived.");
      router.push("/leads");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
      setArchiving(false);
    }
  }

  const scoreParts = scoreComponents(detail.score?.components);
  const widgets = widgetList(detail.latestScan?.chatWidgets);
  const pages = pageList(detail.latestScan?.pageDetails);
  const website = lead.websiteUrl ?? null;

  return (
    <div className="animate-rise">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Link href="/leads" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Leads
        </Link>
        <ChevronRight className="size-3" />
        <span className="truncate font-medium text-foreground">{lead.name}</span>
      </div>

      <PageHeader
        eyebrow={lead.category ?? "Lead"}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            {lead.name}
            <StatusBadge status={lead.status} />
            {lead.isDemo ? <Badge variant="warning">Demo (fictional)</Badge> : null}
            {lead.archivedAt ? <Badge variant="muted">Archived</Badge> : null}
          </span>
        }
        description={[lead.city, lead.country].filter(Boolean).join(", ") || "No location recorded"}
        actions={
          <>
            {website ? (
              <Button asChild variant="outline">
                <a href={website} target="_blank" rel="noopener noreferrer nofollow">
                  <Globe2 /> Visit website
                </a>
              </Button>
            ) : null}
            <Button type="button" onClick={() => void queueScan()} disabled={scanning || !website || Boolean(activeScan)}>
              {scanning ? <Loader2 className="animate-spin" /> : <Radar />}
              {activeScan ? "Scan running" : "Scan website"}
            </Button>
            <Button type="button" variant="outline" onClick={() => void archiveLead()} disabled={archiving}>
              {archiving ? <Loader2 className="animate-spin" /> : <Archive />} Archive
            </Button>
          </>
        }
      />

      {lead.doNotContact ? (
        <div className="mb-5">
          <InlineAlert tone="danger" title="Do not contact">
            This lead is marked do-not-contact. Contact channels stay visible for your records only. Remove the flag
            deliberately if it was set by mistake.
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryTile label="Score" value={<ScoreBadge score={lead.latestScore} />} hint="0–100 opportunity score" />
            <SummaryTile
              label="Chatbot"
              value={<ChatbotBadge result={lead.latestChatbotResult} />}
              hint={
                lead.latestChatbotResult
                  ? CHATBOT_LABELS[lead.latestChatbotResult as ChatbotLabel] ?? "Unknown"
                  : "No completed check yet"
              }
            />
            <SummaryTile
              label="Last checked"
              value={
                <span className="text-sm font-semibold">
                  {lead.lastCheckedAt ? relativeTime(lead.lastCheckedAt) : "Never"}
                </span>
              }
              hint={lead.lastCheckedAt ? formatDateTime(lead.lastCheckedAt, timezone) : "Queue a scan to look"}
            />
          </div>

          <Tabs defaultValue="overview">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="scan">Website scan</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="sources">Sources</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-5">
              <SectionCard
                title="Contact channels"
                description="Only public details recorded from your imports, discovery, or inspected pages."
              >
                {detail.contacts.length ? (
                  <ul className="divide-y divide-border/70">
                    {detail.contacts.map((contact) => {
                      const meta = CONTACT_META[contact.type] ?? { label: contact.type, icon: BadgeCheck };
                      const Icon = meta.icon;
                      return (
                        <li key={contact.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                {contact.type === "email" ? (
                                  <a href={`mailto:${contact.value}`} className="break-all hover:underline">
                                    {contact.value}
                                  </a>
                                ) : contact.type === "phone" ? (
                                  <a href={`tel:${contact.value}`} className="hover:underline">
                                    {contact.value}
                                  </a>
                                ) : contact.type === "whatsapp" ? (
                                  <span className="break-all">{contact.value}</span>
                                ) : contact.normalizedValue.startsWith("http") ? (
                                  <a
                                    href={contact.normalizedValue}
                                    target="_blank"
                                    rel="noopener noreferrer nofollow"
                                    className="break-all hover:underline"
                                  >
                                    {contact.value}
                                  </a>
                                ) : (
                                  <span className="break-all">{contact.value}</span>
                                )}
                                {contact.verifiedByUser ? (
                                  <Badge variant="success">
                                    <BadgeCheck className="mr-1 size-3" /> Verified by you
                                  </Badge>
                                ) : (
                                  <Badge variant="outline">Unverified</Badge>
                                )}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {meta.label}
                                {contact.label ? ` · ${contact.label}` : ""}
                                {contact.platform ? ` · ${contact.platform}` : ""} · found{" "}
                                {relativeTime(contact.firstSeenAt)}
                              </p>
                              {contact.evidence.length ? (
                                <ul className="mt-1.5 space-y-0.5">
                                  {contact.evidence.slice(0, 3).map((evidence) => (
                                    <li key={evidence.id} className="truncate text-[11px] text-muted-foreground">
                                      Evidence:{" "}
                                      <a
                                        href={evidence.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer nofollow"
                                        className="underline underline-offset-2 hover:text-foreground"
                                      >
                                        {evidence.method} on {hostOf(evidence.sourceUrl)}
                                      </a>
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={contact.verifiedByUser ? "outline" : "default"}
                            onClick={() => void verifyContact(contact.id, !contact.verifiedByUser)}
                            className="shrink-0 self-start"
                          >
                            {contact.verifiedByUser ? <X /> : <Check />}
                            {contact.verifiedByUser ? "Remove verification" : "Mark verified"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No contact channels yet. Import details you have rights to use, or scan the website to look for
                    public contact routes.
                  </p>
                )}
              </SectionCard>

              <SectionCard
                title="Score breakdown"
                description={
                  detail.score
                    ? `Profile version ${detail.score.profileVersion} · calculated ${formatDateTime(detail.score.calculatedAt, timezone)}`
                    : "This lead has not been scored yet."
                }
                actions={<ScoreBadge score={lead.latestScore} />}
              >
                {scoreParts.length ? (
                  <div className="space-y-3">
                    {scoreParts.map((part) => {
                      const width = part.max > 0 ? Math.round((part.points / part.max) * 100) : 0;
                      return (
                        <div key={part.key}>
                          <div className="flex items-baseline justify-between gap-3 text-sm">
                            <span className={cn("font-medium", part.withheld && "text-muted-foreground")}>
                              {part.label}
                              {part.withheld ? (
                                <span className="ml-2 text-[11px] font-normal text-warning">withheld</span>
                              ) : null}
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {part.points} / {part.max}
                            </span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn(
                                "h-full rounded-full",
                                part.withheld ? "bg-warning/70" : "bg-primary/80",
                              )}
                              style={{ width: `${Math.max(part.points > 0 ? 3 : 0, width)}%` }}
                            />
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{part.reason}</p>
                        </div>
                      );
                    })}
                    <p className="border-t border-border/70 pt-3 text-xs leading-relaxed text-muted-foreground">
                      Failed, incomplete or unknown scans never award scan-dependent points. Unknown stays unknown.
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Scores appear after a lead is created or recalculated from the scoring settings.
                  </p>
                )}
              </SectionCard>

              {detail.duplicates.length ? (
                <SectionCard
                  title="Possible duplicates"
                  description="Review these pairs before you contact anyone twice."
                  actions={
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/duplicates">Review all</Link>
                    </Button>
                  }
                >
                  <ul className="divide-y divide-border/70">
                    {detail.duplicates.map((pair) => (
                      <li key={pair.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                        <Copy className="size-4 shrink-0 text-warning" />
                        <span className="min-w-0 flex-1 truncate text-sm">{pair.otherName}</span>
                        <Badge variant="warning">{Math.round(pair.similarity * 100)}% similar</Badge>
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/leads/${pair.otherId}`}>Open</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}
            </TabsContent>

            <TabsContent value="scan" className="space-y-5">
              <SectionCard
                title="Latest website scan"
                description="Public pages only. The scanner respects robots.txt, stays polite, and never claims a result it could not verify."
                actions={
                  <Button type="button" variant="outline" size="sm" onClick={() => void queueScan()} disabled={scanning || !website || Boolean(activeScan)}>
                    <Radar /> Queue scan
                  </Button>
                }
              >
                {detail.latestScan ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <ScanOutcomeBadge outcome={detail.latestScan.outcome} />
                      <ChatbotBadge result={detail.latestScan.chatbotResult} />
                      <Badge variant="outline">
                        {detail.latestScan.pagesScanned} checked
                        {detail.latestScan.pagesSkipped ? ` · ${detail.latestScan.pagesSkipped} skipped` : ""}
                      </Badge>
                      {detail.latestScan.platform ? (
                        <Badge variant="outline">
                          {detail.latestScan.platform}
                          {detail.latestScan.platformConfidence ? ` · ${detail.latestScan.platformConfidence}` : ""}
                        </Badge>
                      ) : null}
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(detail.latestScan.createdAt, timezone)}
                      </span>
                    </div>

                    <dl className="grid gap-3 text-sm sm:grid-cols-2">
                      <DetailItem label="Final URL" value={
                        detail.latestScan.finalUrl ? (
                          <a
                            href={detail.latestScan.finalUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="break-all underline underline-offset-2"
                          >
                            {detail.latestScan.finalUrl}
                          </a>
                        ) : "—"
                      } />
                      <DetailItem label="HTTP status" value={detail.latestScan.httpStatus ?? "—"} />
                      <DetailItem label="Page title" value={detail.latestScan.title ?? "—"} />
                      <DetailItem label="Language" value={detail.latestScan.lang ?? "—"} />
                      <DetailItem label="Confidence" value={detail.latestScan.confidence} />
                      <DetailItem label="Pages scanned" value={`${detail.latestScan.pagesScanned} of ${detail.latestScan.pagesScanned + detail.latestScan.pagesSkipped}`} />
                    </dl>

                    {widgets.length ? (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          Chat widgets detected
                        </h3>
                        <ul className="mt-2 space-y-1.5">
                          {widgets.map((widget) => (
                            <li key={`${widget.name}-${widget.pageUrl ?? ""}`} className="flex flex-wrap items-center gap-2 text-sm">
                              <Badge variant="warning">{widget.name}</Badge>
                              {widget.confidence ? <span className="text-xs text-muted-foreground">{widget.confidence} confidence</span> : null}
                              {widget.pageUrl ? <span className="truncate text-xs text-muted-foreground">{widget.pageUrl}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
                        {detail.latestScan.chatbotResult === "not_detected"
                          ? "Not detected in checked pages. This is not proof that no chat service exists."
                          : "Chatbot status is unknown because the scan did not complete cleanly."}
                      </p>
                    )}

                    {pages.length ? (
                      <div>
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pages</h3>
                        <ul className="mt-2 divide-y divide-border/70">
                          {pages.map((page) => (
                            <li key={page.url} className="flex items-center gap-3 py-2 text-sm">
                              <span
                                className={cn(
                                  "size-1.5 shrink-0 rounded-full",
                                  page.outcome === "success" ? "bg-success" : "bg-warning",
                                )}
                              />
                              <span className="min-w-0 flex-1 truncate">{page.url}</span>
                              <Badge variant={page.outcome === "success" ? "success" : "warning"}>
                                {SCAN_OUTCOME_LABELS[page.outcome] ?? page.outcome}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : activeScan ? (
                  <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Loader2 className="size-4 animate-spin" /> Scan {activeScan.status}…
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Queued {relativeTime(activeScan.createdAt)}. Results appear here when the scan finishes.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
                    <Globe2 className="mx-auto size-6 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">This website has not been checked</p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      {website
                        ? "Queue a scan to inspect a few public pages for chat widgets, contact routes and booking links."
                        : "Add a website to this lead before scanning. The app never guesses a domain."}
                    </p>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Scan history" description="The last 50 requests for this lead.">
                {scansQuery.isLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" /> Loading scans…
                  </p>
                ) : scansQuery.data?.items.length ? (
                  <ul className="divide-y divide-border/70">
                    {scansQuery.data.items.map((job) => (
                      <li key={job.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
                        <Radar className="size-4 text-muted-foreground" />
                        <span className="font-medium capitalize">{job.status}</span>
                        {job.outcome ? <ScanOutcomeBadge outcome={job.outcome} /> : null}
                        {job.status === "processing" ? (
                          <span className="text-xs text-muted-foreground">
                            {job.pagesDone}/{job.pagesTotal || "?"} pages
                          </span>
                        ) : null}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatDateTime(job.createdAt, timezone)}
                        </span>
                        {job.error ? <span className="w-full text-xs text-destructive">{job.error}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No scans requested yet.</p>
                )}
              </SectionCard>
            </TabsContent>

            <TabsContent value="activity">
              <SectionCard title="Activity" description="A workspace-scoped record of what changed on this lead.">
                {detail.activities.length ? (
                  <ol className="relative space-y-4 border-l border-border/80 pl-4">
                    {detail.activities.map((item) => (
                      <li key={item.id} className="relative">
                        <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-primary/70 ring-4 ring-card" />
                        <p className="text-sm">{item.message}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground" title={formatDateTime(item.createdAt, timezone)}>
                          {relativeTime(item.createdAt)} · {item.type.replace(/_/g, " ")}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted-foreground">Changes to this lead will show up here.</p>
                )}
              </SectionCard>
            </TabsContent>

            <TabsContent value="sources">
              <SectionCard
                title="Sources and provenance"
                description="Exactly where this record came from. No lead is invented."
              >
                {detail.sources.length ? (
                  <ul className="divide-y divide-border/70">
                    {detail.sources.map((source) => (
                      <li key={source.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-2">
                          <SourceBadge source={source.source} />
                          <span className="truncate text-sm">{source.sourceId}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          {source.attribution ? <span>{source.attribution}</span> : null}
                          <span>{formatDate(source.createdAt, timezone)}</span>
                          {source.importJobId ? (
                            <Link href={`/imports/${source.importJobId}`} className="underline underline-offset-2 hover:text-foreground">
                              Import
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No provenance record for this lead.</p>
                )}
                {detail.merges.length ? (
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Merge history</h3>
                    <ul className="mt-2 space-y-1 text-sm">
                      {detail.merges.map((merge) => (
                        <li key={merge.id} className="flex items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {merge.undoneAt ? "Undone" : "Merged"} {relativeTime(merge.createdAt)}
                          </span>
                          <Link href={`/leads/${merge.mergedBusinessId}`} className="underline underline-offset-2">
                            View merged lead
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </SectionCard>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="min-w-0 space-y-5">
          <SectionCard title="Pipeline" description="Your working state for this lead.">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="lead-status">Stage</Label>
                <Select
                  id="lead-status"
                  value={status}
                  onChange={(event) => void changeStatus(event.target.value as PipelineStatus)}
                >
                  {PIPELINE_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {PIPELINE_STATUS_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-followup">Follow-up</Label>
                <Input
                  id="lead-followup"
                  type="datetime-local"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {lead.followUpAt ? `Currently ${formatDateTime(lead.followUpAt, timezone)}` : "No follow-up scheduled"}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-tags">Tags</Label>
                <Input
                  id="lead-tags"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder="priority, warm, local"
                />
                <p className="text-xs text-muted-foreground">Comma-separated. Existing tags are reused.</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lead-notes">Notes</Label>
                <Textarea
                  id="lead-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={6}
                  placeholder="What did you learn? Keep it factual and useful."
                />
              </div>

              <Button type="button" onClick={() => void saveDetails()} disabled={saving} className="w-full">
                {saving ? <Loader2 className="animate-spin" /> : <Save />} Save details
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Contact controls" description="Manual contact only. The app never sends anything.">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="size-4 text-destructive" /> Do not contact
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    Keeps the lead for records but removes it from default lists.
                  </p>
                </div>
                <Switch checked={doNotContact} onCheckedChange={(next) => void changeDnc(next)} aria-label="Do not contact" />
              </div>
              {website ? (
                <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                  <p className="text-xs font-medium text-muted-foreground">Website</p>
                  <a
                    href={website}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="mt-0.5 block truncate text-sm underline underline-offset-2"
                  >
                    {lead.websiteHost ?? website}
                  </a>
                </div>
              ) : null}
              {lead.email ? (
                <div className="rounded-lg bg-muted/60 px-3 py-2.5">
                  <p className="text-xs font-medium text-muted-foreground">Primary email</p>
                  <a href={`mailto:${lead.email}`} className="mt-0.5 block truncate text-sm underline underline-offset-2">
                    {lead.email}
                  </a>
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Record" description="Read-only metadata.">
            <dl className="space-y-3 text-sm">
              <DetailItem label="Category" value={lead.category ?? "—"} icon={<Building2 className="size-3.5" />} />
              <DetailItem
                label="Address"
                value={[lead.street, lead.area, lead.city, lead.country].filter(Boolean).join(", ") || "—"}
                icon={<MapPin className="size-3.5" />}
              />
              <DetailItem
                label="Coordinates"
                value={lead.lat !== null && lead.lng !== null ? `${lead.lat.toFixed(5)}, ${lead.lng.toFixed(5)}` : "—"}
              />
              <DetailItem
                label="Created"
                value={lead.createdAt ? formatDateTime(lead.createdAt, timezone) : "—"}
                icon={<Clock className="size-3.5" />}
              />
              <DetailItem
                label="Updated"
                value={lead.updatedAt ? relativeTime(lead.updatedAt) : "—"}
                icon={<Activity className="size-3.5" />}
              />
              <DetailItem label="Owner" value={lead.ownerId ? "Assigned" : "Unassigned"} />
            </dl>
            {detail.tags.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
                {detail.tags.map((tag) => (
                  <Badge key={tag.id} variant="outline">
                    <Tag className="mr-1 size-3" /> {tag.name}
                  </Badge>
                ))}
              </div>
            ) : null}
          </SectionCard>

          {detail.lead.notes ? (
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
              <StickyNote className="mt-0.5 size-3.5 shrink-0" />
              <span>Notes are private to this workspace. Nothing here is sent to the business.</span>
            </div>
          ) : null}

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <CircleAlert className="size-3.5" /> Verify details yourself before contacting.
          </div>
        </aside>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-1.5">{value}</div>
      {hint ? <p className="mt-1 truncate text-[11px] text-muted-foreground" title={hint}>{hint}</p> : null}
    </div>
  );
}

function DetailItem({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon} {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm">{value}</dd>
    </div>
  );
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}
