"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  Compass,
  Copy,
  LayoutDashboard,
  LogOut,
  Menu,
  Radar,
  Settings,
  Sparkles,
  Upload,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { useLiveEvents } from "@/lib/client/hooks";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, appInitials } from "@/lib/utils";
import type { WorkspaceSummary } from "@/lib/auth/session";

export interface ShellUser {
  id: string;
  name: string;
  email: string;
}

export interface ShellWorkspace extends WorkspaceSummary {
  timezone: string;
}

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/duplicates", label: "Duplicates", icon: Copy },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/discovery", label: "Discovery", icon: Compass },
  { href: "/scans", label: "Website scans", icon: Radar },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  user,
  workspace,
  workspaces,
  children,
}: {
  user: ShellUser;
  workspace: ShellWorkspace;
  workspaces: WorkspaceSummary[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const refreshTimer = React.useRef<number | null>(null);

  const live = useLiveEvents((event) => {
    if (event.type === "test.event") return;
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      router.refresh();
      window.dispatchEvent(new CustomEvent("lf:live", { detail: event }));
    }, 600);
  });

  React.useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  React.useEffect(() => {
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  async function switchWorkspace(id: string) {
    if (id === workspace.id) return;
    try {
      await apiFetch("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ action: "switch", workspaceId: id }),
      });
      toast.success("Workspace switched");
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between gap-2 px-5 pb-4 pt-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground shadow-sm">
            <Sparkles className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold tracking-tight">
              {process.env.NEXT_PUBLIC_APP_NAME ?? "Lead Finder"}
            </span>
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-muted">
              Lead research
            </span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-active lg:hidden"
          aria-label="Close navigation"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="px-3 pb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl border border-sidebar-border bg-sidebar-active/55 px-3 py-2.5 text-left transition-colors hover:bg-sidebar-active"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/20 text-xs font-semibold text-sidebar-foreground">
                {appInitials(workspace.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{workspace.name}</span>
                <span className="block text-[11px] text-sidebar-muted">
                  {workspace.isDemo ? "Demo workspace" : `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`}
                </span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Your workspaces</DropdownMenuLabel>
            <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
            {workspaces.map((item) => (
              <DropdownMenuItem
                key={item.id}
                onSelect={() => void switchWorkspace(item.id)}
                className={cn("flex-col items-start gap-0.5", item.id === workspace.id && "bg-muted")}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-medium">{item.name}</span>
                  {item.id === workspace.id ? (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Current</span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.isDemo ? "Demo (fictional)" : item.role}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 scrollbar-thin" aria-label="Main navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href, item.exact);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-active text-sidebar-foreground shadow-sm"
                  : "text-sidebar-muted hover:bg-sidebar-active/65 hover:text-sidebar-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className={cn("size-4", active && "text-accent")} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="space-y-3 border-t border-sidebar-border p-3">
        {workspace.isDemo ? (
          <div className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-[11px] leading-relaxed text-sidebar-foreground">
            <strong className="font-semibold">Demo workspace.</strong> All businesses and contacts here are
            fictional examples.
          </div>
        ) : null}
        <div className="flex items-center gap-2 rounded-xl px-1 py-1">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-active text-xs font-semibold">
            {appInitials(user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-[11px] text-sidebar-muted">{user.email}</span>
          </span>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md p-1.5 text-sidebar-muted transition-colors hover:bg-sidebar-active hover:text-sidebar-foreground"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[272px] lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-[288px] max-w-[85vw] shadow-lg">{sidebar}</aside>
        </div>
      ) : null}

      <div className="lg:pl-[272px]">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/88 px-4 backdrop-blur-md sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">
              {workspace.name} · {workspace.timezone}
            </span>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
              live
                ? "border-success/25 bg-success-soft text-success"
                : "border-border bg-muted text-muted-foreground",
            )}
            title={live ? "Live updates connected" : "Live updates reconnecting"}
          >
            <span className={cn("size-1.5 rounded-full", live ? "bg-success" : "bg-muted-foreground")} />
            {live ? "Live" : "Connecting"}
          </span>
          <ThemeToggle compact />
        </header>
        <main className="mx-auto w-full max-w-[1500px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
