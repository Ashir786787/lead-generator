import { getWorkspaceContext } from "@/lib/auth/session";
import { listImports } from "@/lib/import/service";
import {
  listSavedSearches,
  providerStatuses,
} from "@/lib/discovery/service";
import { DiscoveryView } from "@/components/discovery/discovery-view";
import { plannerStatuses } from "@/lib/discovery/ai";

export const dynamic = "force-dynamic";

export default async function DiscoveryPage() {
  const ctx = await getWorkspaceContext();
  const [savedSearches, imports] = await Promise.all([listSavedSearches(ctx), listImports(ctx)]);
  return (
    <DiscoveryView
      initial={{
        providers: providerStatuses(),
        planners: plannerStatuses(),
        savedSearches,
        recent: imports.filter((item) => item.origin === "discovery").slice(0, 8),
      }}
    />
  );
}
