import { redirect } from "next/navigation";
import { getSessionUser, getWorkspaceContext } from "@/lib/auth/session";
import { getSetupStatus } from "@/lib/setup";
import { getWorkerHealth } from "@/lib/jobs/health";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const status = await getSetupStatus();
  if (status.needsSetup) redirect("/setup");

  const user = await getSessionUser();
  if (!user) redirect("/login");

  const ctx = await getWorkspaceContext();
  const worker = await getWorkerHealth();

  return (
    <AppShell
      user={ctx.user}
      workerOnline={worker.online}
      workspace={{
        id: ctx.workspaceId,
        name: ctx.workspaceName,
        slug: ctx.workspaceSlug,
        isDemo: ctx.isDemo,
        role: ctx.role,
        timezone: ctx.timezone,
      }}
      workspaces={ctx.workspaces}
    >
      {children}
    </AppShell>
  );
}
