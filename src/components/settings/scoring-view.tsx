"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Info,
  Loader2,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { ScoreConfig } from "@/lib/client/types";
import { CATEGORY_OPTIONS } from "@/lib/constants";
import { formatDateTime } from "@/lib/utils";
import { PageHeader, SectionCard } from "@/components/page";
import { InlineAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProfileRow {
  id: string;
  name: string;
  version: number;
  isActive: boolean;
  config: ScoreConfig;
  createdAt: string;
}

interface ScoringPayload {
  active: ProfileRow | null;
  profiles: ProfileRow[];
}

interface Impact {
  sampled: number;
  changed: number;
  averageDelta: number;
}

function capTotal(config: ScoreConfig): number {
  return (
    config.industryFit.cap +
    config.websiteInspected.cap +
    config.noChatbot +
    config.whatsappNoChatbot +
    config.contactChannels.cap +
    config.inquiryInteraction.cap
  );
}

export function ScoringView({ initial, timezone }: { initial: ScoringPayload; timezone: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [config, setConfig] = React.useState<ScoreConfig>(() => clone(initial.active?.config ?? fallbackConfig()));
  const [impact, setImpact] = React.useState<Impact | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);

  const scoringQuery = useQuery({
    queryKey: ["scoring"],
    queryFn: () => apiFetch<ScoringPayload>("/api/scoring"),
    initialData: initial,
  });
  const active = scoringQuery.data.active;

  const total = capTotal(config);
  const over = total > 100;

  React.useEffect(() => {
    if (active) setConfig(clone(active.config));
  }, [active]);

  function patchConfig(updater: (draft: ScoreConfig) => void) {
    setConfig((current) => {
      const next = clone(current);
      updater(next);
      return next;
    });
    setImpact(null);
  }

  async function preview() {
    setPending("preview");
    try {
      const result = await apiFetch<{ impact: Impact }>("/api/scoring", {
        method: "POST",
        body: JSON.stringify({ action: "preview", config }),
      });
      setImpact(result.impact);
      toast.success("Preview calculated from your current leads.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function save() {
    if (over) {
      toast.error("The component caps add up to more than 100 points.");
      return;
    }
    setPending("save");
    try {
      await apiFetch("/api/scoring", {
        method: "POST",
        body: JSON.stringify({ action: "save", config }),
      });
      toast.success("New scoring version saved. Existing leads are being recalculated.");
      setImpact(null);
      await scoringQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  async function activate(profileId: string) {
    setPending(`activate:${profileId}`);
    try {
      await apiFetch("/api/scoring", {
        method: "POST",
        body: JSON.stringify({ action: "activate", profileId }),
      });
      toast.success("Profile activated. Leads are being recalculated.");
      await scoringQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="animate-rise">
      <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/settings" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Settings
        </Link>
        <span>/</span>
        <span className="text-foreground">Scoring profile</span>
      </div>

      <PageHeader
        eyebrow="Qualification"
        title="Scoring profile"
        description="A transparent 100-point model. Every component explains itself, and scan-dependent points are withheld when a scan is incomplete or unknown."
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void preview()} disabled={pending !== null}>
              {pending === "preview" ? <Loader2 className="animate-spin" /> : <FlaskConical />} Preview impact
            </Button>
            <Button type="button" onClick={() => void save()} disabled={pending !== null || over}>
              {pending === "save" ? <Loader2 className="animate-spin" /> : <Save />} Save new version
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Active version</p>
          <p className="mt-1 text-xl font-semibold">v{active?.version ?? "—"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {active ? formatDateTime(active.createdAt, timezone) : "No active profile"}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Maximum points</p>
          <p className={over ? "mt-1 text-xl font-semibold tabular-nums text-destructive" : "mt-1 text-xl font-semibold tabular-nums"}>
            {total} / 100
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {over ? "Reduce component caps before saving." : "Within the allowed maximum."}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Version history</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{scoringQuery.data.profiles.length}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Older versions stay available.</p>
        </div>
      </div>

      {over ? (
        <div className="mb-5">
          <InlineAlert tone="danger" title="Caps exceed 100 points">
            The component maximums currently add up to {total}. Reduce one or more caps before saving.
          </InlineAlert>
        </div>
      ) : null}

      {impact ? (
        <div className="mb-5">
          <InlineAlert tone="info" title="Preview impact">
            Sampled {impact.sampled} leads. {impact.changed} would change score. Average change:{" "}
            {impact.averageDelta > 0 ? "+" : ""}
            {impact.averageDelta} points. Nothing has been saved yet.
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard
            title="Industry fit"
            description="How strongly a category matches the product's ideal customer."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                id="industry-cap"
                label="Category cap"
                value={config.industryFit.cap}
                onChange={(value) => patchConfig((draft) => { draft.industryFit.cap = value; })}
              />
              <NumField
                id="industry-default"
                label="Default category points"
                value={config.industryFit.defaultPoints}
                onChange={(value) => patchConfig((draft) => { draft.industryFit.defaultPoints = value; })}
              />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {CATEGORY_OPTIONS.map((option) => (
                <NumField
                  key={option.key}
                  id={`category-${option.key}`}
                  label={option.label}
                  value={config.industryFit.categories[option.key] ?? 0}
                  onChange={(value) =>
                    patchConfig((draft) => {
                      draft.industryFit.categories[option.key] = value;
                    })
                  }
                />
              ))}
            </div>
          </SectionCard>

          <SectionCard
            title="Website and chat signals"
            description="Scan-dependent points are only awarded after a completed page check."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                id="website-cap"
                label="Website inspected cap"
                value={config.websiteInspected.cap}
                onChange={(value) => patchConfig((draft) => { draft.websiteInspected.cap = value; })}
                hint="Awarded only for a successful scan."
              />
              <NumField
                id="no-chatbot"
                label="No chatbot found"
                value={config.noChatbot}
                onChange={(value) => patchConfig((draft) => { draft.noChatbot = value; })}
                hint="Only when a completed scan found no widget."
              />
              <NumField
                id="whatsapp-no-chatbot"
                label="WhatsApp and no chatbot"
                value={config.whatsappNoChatbot}
                onChange={(value) => patchConfig((draft) => { draft.whatsappNoChatbot = value; })}
                hint="Extra points for an explicit WhatsApp link."
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Contact channels"
            description="Public ways a customer could reach this business."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                id="channels-cap"
                label="Channel cap"
                value={config.contactChannels.cap}
                onChange={(value) => patchConfig((draft) => { draft.contactChannels.cap = value; })}
              />
              <NumField
                id="channel-email"
                label="Email"
                value={config.contactChannels.email}
                onChange={(value) => patchConfig((draft) => { draft.contactChannels.email = value; })}
              />
              <NumField
                id="channel-phone"
                label="Phone"
                value={config.contactChannels.phone}
                onChange={(value) => patchConfig((draft) => { draft.contactChannels.phone = value; })}
              />
              <NumField
                id="channel-whatsapp"
                label="WhatsApp"
                value={config.contactChannels.whatsapp}
                onChange={(value) => patchConfig((draft) => { draft.contactChannels.whatsapp = value; })}
              />
              <NumField
                id="channel-form"
                label="Contact form"
                value={config.contactChannels.contactForm}
                onChange={(value) => patchConfig((draft) => { draft.contactChannels.contactForm = value; })}
              />
            </div>
          </SectionCard>

          <SectionCard
            title="Inquiry and booking"
            description="Interaction routes that suggest an active customer journey."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <NumField
                id="inquiry-cap"
                label="Inquiry cap"
                value={config.inquiryInteraction.cap}
                onChange={(value) => patchConfig((draft) => { draft.inquiryInteraction.cap = value; })}
              />
              <NumField
                id="inquiry-booking"
                label="Booking link"
                value={config.inquiryInteraction.booking}
                onChange={(value) => patchConfig((draft) => { draft.inquiryInteraction.booking = value; })}
              />
              <NumField
                id="inquiry-form"
                label="Inquiry form"
                value={config.inquiryInteraction.inquiryForm}
                onChange={(value) => patchConfig((draft) => { draft.inquiryInteraction.inquiryForm = value; })}
              />
            </div>
          </SectionCard>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => {
              if (active) {
                setConfig(clone(active.config));
                setImpact(null);
              }
            }}>
              <RotateCcw /> Reset to active
            </Button>
            <Button type="button" variant="outline" onClick={() => void preview()} disabled={pending !== null}>
              <FlaskConical /> Preview impact
            </Button>
            <Button type="button" onClick={() => void save()} disabled={pending !== null || over}>
              <Save /> Save new version
            </Button>
          </div>
        </div>

        <aside className="space-y-5">
          <SectionCard title="How scores stay honest" description="The rules encoded in this model.">
            <ul className="space-y-2.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                A successful scan is required before any scan-dependent points are awarded.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                A blocked, partial or unknown scan never counts as “no chatbot”.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                Contact points only count when they were actually recorded.
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                The profile version is stored with every score for future audits.
              </li>
            </ul>
          </SectionCard>

          <SectionCard title="Version history" description="Older profiles remain available.">
            {scoringQuery.data.profiles.length ? (
              <ul className="divide-y divide-border/70">
                {scoringQuery.data.profiles.map((profile) => (
                  <li key={profile.id} className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
                    <SlidersHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        v{profile.version} · {profile.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{formatDateTime(profile.createdAt, timezone)}</p>
                    </div>
                    {profile.isActive ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void activate(profile.id)}
                        disabled={pending !== null}
                      >
                        {pending === `activate:${profile.id}` ? <Loader2 className="animate-spin" /> : null}
                        Activate
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No profiles saved yet.</p>
            )}
          </SectionCard>

          <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-4 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Saving or activating a profile queues a recalculation for every lead in this workspace. Existing scores
              remain visible until the job finishes.
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function NumField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        step={1}
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : 0);
        }}
        className="tabular-nums"
      />
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function clone(config: ScoreConfig): ScoreConfig {
  return JSON.parse(JSON.stringify(config)) as ScoreConfig;
}

function fallbackConfig(): ScoreConfig {
  return {
    industryFit: { cap: 30, defaultPoints: 10, categories: {} },
    websiteInspected: { cap: 15 },
    noChatbot: 20,
    whatsappNoChatbot: 5,
    contactChannels: { cap: 20, email: 8, phone: 4, whatsapp: 4, contactForm: 4 },
    inquiryInteraction: { cap: 10, booking: 6, inquiryForm: 4 },
  };
}
