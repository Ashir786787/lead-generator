import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSetupStatus } from "@/lib/setup";
import { redirectIfAuthenticated, requireLoginMode } from "@/lib/auth/page-guards";
import { LoginForm } from "@/components/auth-forms";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sparkles } from "lucide-react";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await requireLoginMode();
  await redirectIfAuthenticated();
  const status = await getSetupStatus();
  if (status.needsSetup) redirect("/setup");
  const allowSignup = process.env.ALLOW_SIGNUP === "true" || process.env.ALLOW_SIGNUP === "1";

  return (
    <div className="hero-glow flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">{status.appName}</span>
          </Link>
          <ThemeToggle />
        </div>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-md sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1 text-sm text-muted-foreground">Sign in to your lead research workspace.</p>
          </div>
          <LoginForm allowSignup={allowSignup} />
        </div>
        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          No automated outreach is sent from this app. Always check local advertising, privacy and consent rules
          before contacting a business.
        </p>
      </div>
    </div>
  );
}
