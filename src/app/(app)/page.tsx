import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Compass,
  Copy,
  FileUp,
  Globe2,
  Mail,
  MessageSquareOff,
  Plus,
  Radar,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { collections } from "@/lib/db";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getWorkspaceOverview } from "@/lib/data/facets";
import { listLeads } from "@/lib/data/leads";
import { parseLeadQuery } from "@/lib/data/filters";
import { listImports } from "@/lib/import/service";
import { scanQueueSummary } from "@/lib/scan/service";
import { PIPELINE_STATUS_LABELS, OUTREACH_CHECKLIST, type PipelineStatus } from "@/lib/constants";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { PageHeader, StatCard, EmptyState } from "@/components/page";
import { InlineAlert } from "@/components/form";
import { ScoreBadge, StatusBadge } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getWorkspaceContext();
  const [overview, leads, imports, scans, activityRows] = await Promise.all([
    getWorkspaceOverview(ctx),
    listLeads(ctx, parseLeadQuery({ sort: "score_desc", pageSize: "6" })),
    listImports(ctx),
    scanQueueSummary(ctx),
    collections.activities
      .find(
        { workspaceId: ctx.workspaceId },
        { projection: { _id: 1, type: 1, message: 1, createdAt: 1 } },
      )
      .sort({ createdAt: -1 })
      .limit(8)
      .toArray()
      .then((activities) =>
        activities.map((activity) => ({
          id: activity._id,
          type: activity.type,
          message: activity.message,
          createdAt: activity.createdAt,
        })),
      ),
  ]);

  const pipeline: Array<{ status: PipelineStatus; count: number }> = [
    { status: "new", count: overview.fresh },
    { status: "reviewing", count: overview.reviewed },
    { status: "qualified", count: overview.qualified },
    { status: "contacted", count: overview.contacted },
    { status: "won", count: overview.won },
  ];
  const maxStage = Math.max(1, ...pipeline.map((stage) => stage.count));
  const needsAttention = [
    {
      label: "Possible duplicates to review",
      value: overview.pendingDuplicates,
      href: "/duplicates",
      icon: Copy,
    },
    {
      label: "Overdue follow-ups",
      value: leads.stats.overdueFollowUps,
      href: "/leads?followUp=overdue",
      icon: CircleDashed,
    },
    {
      label: "Scans needing a manual look",
      value: scans.needsReview,
      href: "/scans",
      icon: Radar,
    },
    {
      label: "Websites never checked",
      value: scans.neverChecked,
      href: "/leads?hasWebsite=true&sort=last_checked_desc",
      icon: Globe2,
    },
  ].filter((item) => item.value > 0);

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Workspace overview"
        title={`Good ${greeting()}, ${firstName(ctx.user.name)}`}
        description={
          ctx.isDemo
            ? "You are exploring a fictional demo workspace. Nothing here represents a real business."
            : "Your research pipeline at a glance. Everything is scoped to this workspace."
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/discovery">
                <Compass /> Discover
              </Link>
            </Button>
            <Button asChild>
              <Link href="/leads?new=1">
                <Plus /> Add lead
              </Link>
            </Button>
          </>
        }
      />

      {ctx.isDemo ? (
        <div className="mb-6">
          <InlineAlert tone="warning" title="Demo (fictional) workspace">
            These records and contacts are made up to demonstrate the product. Do not contact them. Use{" "}
            <Link href="/discovery" className="font-medium underline underline-offset-2">
              live discovery
            </Link>{" "}
            or your own imports for real data.
          </InlineAlert>
        </div>
      ) : null}

      {overview.total === 0 ? (
        <div className="space-y-6">
          <EmptyState
            icon={<Sparkles className="size-5" />}
            title="Your workspace is ready for its first leads"
            description="Bring real data in three ways. Nothing is generated or invented for you."
            actions={
              <>
                <Button asChild>
                  <Link href="/imports">
                    <FileUp /> Import a list
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/discovery">
                    <Compass /> Discover live businesses
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/leads?new=1">
                    <Plus /> Add one manually
                  </Link>
                </Button>
              </>
            }
          />
          <div className="grid gap-4 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Bring in businesses",
                body: "Upload CSV, TSV, GeoJSON or ZIP exports you have the right to use, or run a small OpenStreetMap search.",
                icon: FileUp,
              },
              {
                step: "02",
                title: "Check public websites",
                body: "Queue a scan to look for chat widgets, contact routes and booking links. Failed scans never pretend to be negative results.",
                icon: Radar,
              },
              {
                step: "03",
                title: "Qualify and review",
                body: "Use the 100-point score, tag leads, resolve duplicates and make contact yourself — the app never sends outreach.",
                icon: Target,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="rounded-xl border border-border bg-card p-5 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-2xl font-semibold tracking-tighter text-muted-foreground/35">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              label="Active leads"
              value={formatNumber(overview.total)}
              hint={`${formatNumber(overview.withWebsite)} have a website`}
              icon={<Users />}
            />
            <StatCard
              label="Qualified"
              value={formatNumber(overview.qualified)}
              hint="Marked ready for outreach"
              icon={<Target />}
              tone="positive"
            />
            <StatCard
              label="Average score"
              value={overview.avgScore === null ? "—" : overview.avgScore}
              hint="Across scored leads"
              icon={<TrendingUp />}
            />
            <StatCard
              label="Checked successfully"
              value={formatNumber(overview.checkedSuccess)}
              hint={`${formatNumber(overview.chatbotDetected)} chats detected`}
              icon={<Globe2 />}
            />
            <StatCard
              label="Possible duplicates"
              value={formatNumber(overview.pendingDuplicates)}
              hint="Merchant pairs awaiting review"
              icon={<Copy />}
              tone={overview.pendingDuplicates > 0 ? "warning" : "default"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
            <section className="rounded-xl border border-border bg-card shadow-sm">
              <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold">Recent high-score leads</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Ranked by the active scoring profile.</p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/leads">
                    View all <ArrowRight />
                  </Link>
                </Button>
              </div>
              <ul className="divide-y divide-border/70">
                {leads.items.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/55"
                    >
                      <ScoreBadge score={lead.latestScore} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{lead.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[lead.category, lead.city].filter(Boolean).join(" · ") || "No category or city"}
                        </span>
                      </span>
                      <StatusBadge status={lead.status} />
                    </Link>
                  </li>
                ))}
              </ul>
              {leads.items.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted-foreground">No active leads.</p>
              ) : null}
            </section>

            <div className="space-y-4">
              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Pipeline</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">Active leads by stage.</p>
                  </div>
                  <Badge variant="outline">{formatNumber(overview.total)} total</Badge>
                </div>
                <div className="space-y-3">
                  {pipeline.map((stage) => (
                    <Link key={stage.status} href={`/leads?status=${stage.status}`} className="block group">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground group-hover:text-primary">
                          {PIPELINE_STATUS_LABELS[stage.status]}
                        </span>
                        <span className="tabular-nums text-muted-foreground">{formatNumber(stage.count)}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/80 transition-[width]"
                          style={{ width: `${Math.round((stage.count / maxStage) * 100)}%` }}
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <h2 className="text-sm font-semibold">Detection honesty</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  Chatbot coverage only uses completed page checks. Unknown stays unknown.
                </p>
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg bg-warning-soft p-2.5">
                    <p className="text-lg font-semibold tabular-nums text-warning">
                      {formatNumber(overview.chatbotDetected)}
                    </p>
                    <p className="text-[10px] font-medium leading-tight text-warning">Detected</p>
                  </div>
                  <div className="rounded-lg bg-success-soft p-2.5">
                    <p className="text-lg font-semibold tabular-nums text-success">
                      {formatNumber(overview.chatbotNotDetected)}
                    </p>
                    <p className="text-[10px] font-medium leading-tight text-success">Not detected</p>
                  </div>
                  <div className="rounded-lg bg-muted p-2.5">
                    <p className="text-lg font-semibold tabular-nums">{formatNumber(overview.chatbotUnknown)}</p>
                    <p className="text-[10px] font-medium leading-tight text-muted-foreground">Unknown</p>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <section className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border/70 px-5 py-4">
                <h2 className="text-sm font-semibold">Needs attention</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Small queues worth clearing today.</p>
              </div>
              <ul className="divide-y divide-border/70">
                {needsAttention.length === 0 ? (
                  <li className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
                    <CheckCircle2 className="size-4 text-success" /> Nothing urgent. Nice.
                  </li>
                ) : (
                  needsAttention.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.label}>
                        <Link
                          href={item.href}
                          className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-muted/55"
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">{item.label}</span>
                          <Badge variant={item.value > 0 ? "warning" : "outline"}>{formatNumber(item.value)}</Badge>
                        </Link>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-card shadow-sm">
              <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">Recent imports</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Lists and discovery runs.</p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/imports">All</Link>
                </Button>
              </div>
              <ul className="divide-y divide-border/70">
                {imports.slice(0, 4).map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/imports/${item.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/55"
                    >
                      <FileUp className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.filename}</span>
                        <span className="block text-xs text-muted-foreground">
                          {item.status} · {formatNumber(item.newCount)} new
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {imports.length === 0 ? (
                  <li className="px-5 py-6 text-sm text-muted-foreground">No imports yet.</li>
                ) : null}
              </ul>
            </section>

            <section className="rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border/70 px-5 py-4">
                <h2 className="text-sm font-semibold">Activity</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Latest workspace events.</p>
              </div>
              <ul className="space-y-3 px-5 py-4">
                {activityRows.map((activity) => (
                  <li key={activity.id} className="text-sm">
                    <p className="leading-snug">{activity.message}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground" title={formatDateTime(activity.createdAt, ctx.timezone)}>
                      {relativeTime(activity.createdAt)}
                    </p>
                  </li>
                ))}
                {activityRows.length === 0 ? (
                  <li className="text-sm text-muted-foreground">Activity will appear here.</li>
                ) : null}
              </ul>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-gradient-to-br from-card to-muted/40 p-5 shadow-sm">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/15 text-accent">
                  <MessageSquareOff className="size-5" />
                </span>
                <div>
                  <h2 className="text-sm font-semibold">Outreach stays manual — by design</h2>
                  <p className="mt-0.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {OUTREACH_CHECKLIST[0]} {OUTREACH_CHECKLIST[3]} Check local rules before you contact anyone.
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/settings">
                  <Mail /> Read the checklist
                </Link>
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}
