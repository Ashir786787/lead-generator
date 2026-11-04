import { getWorkspaceContext } from "@/lib/auth/session";
import { getWorkspaceSettings } from "@/lib/data/workspace";
import { SettingsView } from "@/components/settings/settings-view";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getWorkspaceContext();
  const settings = await getWorkspaceSettings(ctx);
  return <SettingsView initial={settings} role={ctx.role} timezone={ctx.timezone} />;
}
