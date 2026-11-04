import { getWorkspaceContext } from "@/lib/auth/session";
import { listImports } from "@/lib/import/service";
import { ImportsView } from "@/components/imports/imports-view";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const ctx = await getWorkspaceContext();
  const items = await listImports(ctx);
  return <ImportsView initial={items} timezone={ctx.timezone} />;
}
