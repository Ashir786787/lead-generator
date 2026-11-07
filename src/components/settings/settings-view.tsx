"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clock,
  Database,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { authClient } from "@/lib/auth/client";
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
  currentUserId,
}: {
  initial: WorkspaceSettings;
  role: "owner" | "member";
  timezone: string;
  currentUserId: string;
}) {
  const router = useRouter();
  const [settings, setSettings] = React.useState(initial);
  const [name, setName] = React.useState(initial.name);
  const [tz, setTz] = React.useState(initial.timezone);
  const [memberName, setMemberName] = React.useState("");
  const [memberEmail, setMemberEmail] = React.useState("");
  const [memberPassword, setMemberPassword] = React.useState("");
  const [memberDestination, setMemberDestination] = React.useState<"shared" | "personal">("shared");
  const [memberActionId, setMemberActionId] = React.useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [changingPassword, setChangingPassword] = React.useState(false);
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

  async function setMemberRole(userId: string, memberRole: "owner" | "member") {
    setMemberActionId(userId);
    try {
      await apiFetch("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ action: "set_member_role", userId, role: memberRole }),
      });
      toast.success(memberRole === "owner" ? "Promoted to owner." : "Changed to member.");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMemberActionId(null);
    }
  }

  async function removeMember(member: { id: string; name: string; email: string }) {
    const confirmed = window.confirm(
      `Remove ${member.name} (${member.email}) from this workspace?\n\nThey keep their account and any other workspaces. You can add them again later.`,
    );
    if (!confirmed) return;
    setMemberActionId(member.id);
    try {
      await apiFetch("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ action: "remove_member", userId: member.id }),
      });
      toast.success(`${member.name} removed from this workspace.`);
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setMemberActionId(null);
    }
  }

  async function changePassword() {
    if (newPassword.length < 8) {
      toast.error("Use at least 8 characters for the new password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The new passwords do not match.");
      return;
    }
    setChangingPassword(true);
    try {
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (result.error) throw result.error;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password changed. Other sessions were signed out.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setChangingPassword(false);
    }
  }

  async function addMember() {
    const email = memberEmail.trim();
    if (!email || memberPassword.length < 8) return;
    setAdding(true);
    try {
      const result = await apiFetch<{
        member: { created: boolean; passwordUpdated: boolean; destination: "shared" | "personal" };
      }>(
        "/api/workspaces",
        {
          method: "POST",
          body: JSON.stringify({
            action: "add_member",
            email,
            password: memberPassword,
            name: memberName.trim() || undefined,
            destination: memberDestination,
          }),
        },
      );
      toast.success(
        result.member.destination === "personal"
          ? `Password set for ${email}. They'll find their own personal workspace when they sign in.`
          : result.member.created
            ? `Account created and added for ${email}.`
            : `Password set and ${email} added to the workspace.`,
      );
      setMemberEmail("");
      setMemberPassword("");
      setMemberName("");
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
            title="Security"
            description="Change the password for your own account. Signs out other sessions."
          >
            <div className="space-y-4">
              <Field label="Current password" htmlFor="current-password" required>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Your current password"
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="New password" htmlFor="new-password" required>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    placeholder="At least 8 characters"
                  />
                </Field>
                <Field label="Confirm new password" htmlFor="confirm-password" required>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="Repeat it"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void changePassword()}
                  disabled={changingPassword || !currentPassword || newPassword.length < 8}
                >
                  {changingPassword ? <Loader2 className="animate-spin" /> : <KeyRound />} Change password
                </Button>
                <span className="text-xs text-muted-foreground">
                  Forgot it? Ask whoever runs the server to reset it for you.
                </span>
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
                    <p className="truncate text-sm font-medium">
                      {member.name}
                      {member.id === currentUserId ? (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Badge variant={member.role === "owner" ? "default" : "outline"} className="capitalize">
                    {member.role}
                  </Badge>
                  <span className="w-full text-xs text-muted-foreground sm:w-auto">
                    joined {formatDate(member.joinedAt, timezone)}
                  </span>
                  {isOwner ? (
                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={memberActionId !== null}
                        onClick={() =>
                          void setMemberRole(member.id, member.role === "owner" ? "member" : "owner")
                        }
                      >
                        {memberActionId === member.id ? (
                          <Loader2 className="animate-spin" />
                        ) : null}
                        {member.role === "owner" ? "Make member" : "Make owner"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="iconSm"
                        className="text-destructive hover:bg-destructive/10"
                        aria-label={`Remove ${member.name} from this workspace`}
                        title="Remove from workspace"
                        disabled={memberActionId !== null}
                        onClick={() => void removeMember(member)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>

            {isOwner ? (
              <div className="mt-4 border-t border-border/70 pt-4">
                <Field
                  label="Add a member"
                  htmlFor="member-email"
                  hint="Creates the account if it does not exist and sets the password you choose (stored hashed). Pick where they work: join this workspace as a member, or keep their own personal workspace. If the account already exists, its password is reset to what you type."
                >
                  <div className="mb-3">
                    <Select
                      id="member-destination"
                      aria-label="Where the member works"
                      value={memberDestination}
                      onChange={(event) => setMemberDestination(event.target.value as "shared" | "personal")}
                    >
                      <option value="shared">Join this workspace as a member</option>
                      <option value="personal">Use their own personal workspace (no access to yours)</option>
                    </Select>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]">
                    <Input
                      id="member-name"
                      aria-label="Name (optional)"
                      value={memberName}
                      onChange={(event) => setMemberName(event.target.value)}
                      placeholder="Name (optional)"
                      maxLength={120}
                    />
                    <Input
                      id="member-email"
                      type="email"
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="person@example.com"
                      maxLength={320}
                    />
                    <Input
                      id="member-password"
                      type="password"
                      autoComplete="new-password"
                      value={memberPassword}
                      onChange={(event) => setMemberPassword(event.target.value)}
                      placeholder="Password (min 8 characters)"
                    />
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Button
                      type="button"
                      onClick={() => void addMember()}
                      disabled={!memberEmail.trim() || memberPassword.length < 8 || adding}
                      className="shrink-0"
                    >
                      {adding ? <Loader2 className="animate-spin" /> : <UserPlus />} Create & add
                    </Button>
                    {memberEmail.trim() && memberPassword.length > 0 && memberPassword.length < 8 ? (
                      <span className="text-xs text-muted-foreground">Password needs at least 8 characters.</span>
                    ) : null}
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
