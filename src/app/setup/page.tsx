import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { redirectIfAuthenticated, requireSetupMode } from "@/lib/auth/page-guards";
import { getSetupStatus, ownerHint } from "@/lib/setup";
import { SetupForm } from "@/components/auth-forms";
import { ThemeToggle } from "@/components/theme-toggle";
import { ShieldCheck, Sparkles } from "lucide-react";

export const metadata: Metadata = { title: "Set up your workspace" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  await requireSetupMode();
  await redirectIfAuthenticated();
  const [status, hint] = await Promise.all([getSetupStatus(), ownerHint()]);
  if (!status.needsSetup) redirect("/login");

  return (
    <div className="hero-glow min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-4 py-10 lg:grid-cols-[0.95fr_1.05fr] lg:px-8">
        <div className="hidden lg:block">
          <Link href="/setup" className="mb-10 inline-flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">{status.appName}</span>
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">First-run setup</p>
          <h1 className="mt-3 max-w-md text-4xl font-semibold leading-tight tracking-tight">
            Build a cleaner pipeline from public business data.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Import your own lists or discover live businesses from OpenStreetMap. Check public websites for chat
            widgets and contact routes, then qualify opportunities with a score you control.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              Workspace-scoped data, no automated email, SMS or WhatsApp.
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              Detection labels stay honest: detected, not detected in checked pages, unknown.
            </li>
            <li className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              Demo data lives in a separate, clearly labelled fictional workspace.
            </li>
          </ul>
        </div>

        <div className="w-full justify-self-center lg:max-w-md">
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <Link href="/setup" className="inline-flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </span>
              <span className="font-semibold">{status.appName}</span>
            </Link>
            <ThemeToggle compact />
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 shadow-md sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold tracking-tight">Create your workspace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This is the only open sign-up. Everything stays on this machine.
              </p>
            </div>
            <SetupForm ownerHint={hint} />
          </div>
          <div className="mt-4 flex justify-center lg:justify-end">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </div>
  );
}
