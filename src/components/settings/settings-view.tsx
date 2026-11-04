"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Database,
  Loader2,
  Lock,
  Mail,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { WorkspaceSettings } from "@/lib/client/types";
import { OUTREACH_CHECKLIST } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { PageHeader, SectionCard } from "@/components/page";
import { Field, InlineAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Rome",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function SettingsView({
  initial,
  role,
  timezone,
}: {
  initial: WorkspaceSettings;
  role: "owner" | "member";
  timezone: string;
}) {
  const router = useRouter();
  const [settings, setSettings] = React.useState(initial);
  const [name, setName] = React.useState(initial.name);
  const [tz, setTz] = React.useState(initial.timezone);
  const [email, setEmail] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [adding, setAdding] = React.useState(false);

  const isOwner = role === "owner";

  async function save() {
    setSaving(true);
    try {
      const result = await apiFetch<{ settings: WorkspaceSettings }>("/api/workspaces", {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), timezone: tz }),
      });
      setSettings(result.settings);
      setName(result.settings.name);
      toast.success("Workspace settings saved.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function addMember() {
    if (!email.trim()) return;
    setAdding(true);
    try {
      await apiFetch("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ action: "add_member", email: email.trim() }),
      });
      toast.success("Member added.");
      setEmail("");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Control how this workspace looks and who can work in it. Outreach always stays manual."
        actions={
          <Button asChild variant="outline">
            <Link href="/settings/scoring">
              <SlidersHorizontal /> Scoring profile
            </Link>
          </Button>
        }
      />

      {settings.isDemo ? (
        <div className="mb-5">
          <InlineAlert tone="warning" title="Demo (fictional) workspace">
            Every business and contact here is an illustrative fictional record. Do not contact them. Switch to your
            real workspace for live work.
          </InlineAlert>
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard title="Workspace" description="The name and timezone used across the app.">
            <div className="space-y-4">
              <Field label="Workspace name" htmlFor="workspace-name" required>
                <Input
                  id="workspace-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  disabled={!isOwner}
                />
              </Field>
              <Field label="Timezone" htmlFor="workspace-timezone" hint="Used for dates in lists, activity and exports. Stored as IANA timezone.">
                <Select
                  id="workspace-timezone"
                  value={tz}
                  onChange={(event) => setTz(event.target.value)}
                  disabled={!isOwner}
                >
                  {TIMEZONES.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                  {TIMEZONES.includes(settings.timezone) ? null : (
                    <option value={settings.timezone}>{settings.timezone}</option>
                  )}
                </Select>
              </Field>
              <div className="flex items-center gap-3">
                <Button type="button" onClick={() => void save()} disabled={!isOwner || saving || (!name.trim())}>
                  {saving ? <Loader2 className="animate-spin" /> : <Save />} Save changes
                </Button>
                {!isOwner ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3.5" /> Only owners can edit this.
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Current zone: {settings.timezone}</span>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Members"
            description="People with access to this workspace. Each person sees only workspaces they belong to."
          >
            <ul className="divide-y divide-border/70">
              {settings.members.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {member.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{member.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Badge variant={member.role === "owner" ? "default" : "outline"} className="capitalize">
                    {member.role}
                  </Badge>
                  <span className="w-full text-xs text-muted-foreground sm:w-auto">
                    joined {formatDate(member.joinedAt, timezone)}
                  </span>
                </li>
              ))}
            </ul>

            {isOwner ? (
              <div className="mt-4 border-t border-border/70 pt-4">
                <Field
                  label="Add an existing account"
                  htmlFor="member-email"
                  hint="The person must already have an account in this app."
                >
                  <div className="flex gap-2">
                    <Input
                      id="member-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="teammate@example.com"
                    />
                    <Button type="button" onClick={() => void addMember()} disabled={!email.trim() || adding} className="shrink-0">
                      {adding ? <Loader2 className="animate-spin" /> : <UserPlus />} Add
                    </Button>
                  </div>
                </Field>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Data and isolation" description="How your workspace data is kept separate.">
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <Database className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>Every workspace-owned record carries a workspace ID. Reads and writes are scoped on the server.</span>
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>Uploads are size-limited, type-checked and stored outside the public web root.</span>
              </li>
              <li className="flex items-start gap-3">
                <Lock className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>This app never sends email, SMS or WhatsApp messages. It never posts to social networks.</span>
              </li>
              <li className="flex items-start gap-3">
                <Clock className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>Website scans respect robots.txt and use a polite, identifying user agent.</span>
              </li>
            </ul>
          </SectionCard>
        </div>

        <aside className="space-y-5">
          <SectionCard title="Outreach checklist" description="Before you contact anyone, read this.">
            <ol className="space-y-2.5">
              {OUTREACH_CHECKLIST.map((item, index) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {index + 1}
                  </span>
                  <span className="leading-relaxed">{item}</span>
                </li>
              ))}
            </ol>
            <div className="mt-4 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              The app gives you no send button anywhere. Make contact yourself from your own email or phone, and keep a
              record of what you sent.
            </div>
          </SectionCard>

          <SectionCard title="Scoring profile" description="The 100-point model behind each lead score.">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Adjust category weights, scan-dependent points and contact-channel values. Failed or incomplete scans
              never award scan-dependent points.
            </p>
            <Button asChild variant="outline" className="mt-3 w-full">
              <Link href="/settings/scoring">
                <SlidersHorizontal /> Open scoring profile
              </Link>
            </Button>
          </SectionCard>

          <div className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
            <Users className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">{settings.members.length} member{settings.members.length === 1 ? "" : "s"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Workspace ID ends in {settings.id.slice(-6)}
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Mail className="size-3.5" /> No outbound messaging is built into this product.
          </div>
        </aside>
      </div>
    </div>
  );
}
