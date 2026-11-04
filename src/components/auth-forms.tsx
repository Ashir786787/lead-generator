"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, LockKeyhole, Mail, User } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form";

function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return "Could not complete that request. Please try again.";
}

export function SetupForm({ ownerHint }: { ownerHint?: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ name: "", email: ownerHint ?? "", password: "", confirm: "" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (form.password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (form.password !== form.confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setPending(true);
    try {
      const result = await authClient.signUp.email({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      if (result.error) throw result.error;
      toast.success("Workspace created. Welcome aboard.");
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <div className="rounded-lg border border-destructive/25 bg-danger-soft px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}
      <Field label="Your name" htmlFor="name" required>
        <div className="relative">
          <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="name"
            autoComplete="name"
            required
            value={form.name}
            onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
            placeholder="Alex Morgan"
            className="pl-9"
          />
        </div>
      </Field>
      <Field label="Email address" htmlFor="email" required>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))}
            placeholder="you@company.com"
            className="pl-9"
          />
        </div>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" htmlFor="password" hint="At least 8 characters." required>
          <div className="relative">
            <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))}
              className="pl-9"
            />
          </div>
        </Field>
        <Field label="Confirm password" htmlFor="confirm" required>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.confirm}
            onChange={(event) => setForm((value) => ({ ...value, confirm: event.target.value }))}
          />
        </Field>
      </div>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {pending ? "Creating workspace…" : "Create workspace"}
        {!pending ? <ArrowRight /> : null}
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">
        This creates the first owner account and a private workspace. Sign-up is closed after this step unless
        the owner enables it.
      </p>
    </form>
  );
}

export function LoginForm({ allowSignup }: { allowSignup: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ email: "", password: "" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({
        email: form.email.trim(),
        password: form.password,
      });
      if (result.error) throw result.error;
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <div className="rounded-lg border border-destructive/25 bg-danger-soft px-3 py-2 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}
      <Field label="Email address" htmlFor="email" required>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={(event) => setForm((value) => ({ ...value, email: event.target.value }))}
            placeholder="you@company.com"
            className="pl-9"
          />
        </div>
      </Field>
      <Field label="Password" htmlFor="password" required>
        <div className="relative">
          <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={form.password}
            onChange={(event) => setForm((value) => ({ ...value, password: event.target.value }))}
            className="pl-9"
          />
        </div>
      </Field>
      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {!pending ? <ArrowRight /> : null}
      </Button>
      {allowSignup ? (
        <p className="text-center text-xs text-muted-foreground">
          Need another account?{" "}
          <Link href="/setup" className="font-medium text-primary underline-offset-4 hover:underline">
            Create one
          </Link>
        </p>
      ) : null}
    </form>
  );
}
