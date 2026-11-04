import { getWorkspaceContext } from "@/lib/auth/session";
import { listScanJobs, scanQueueSummary } from "@/lib/scan/service";
import { ScansView } from "@/components/scans/scans-view";

export const dynamic = "force-dynamic";

export default async function ScansPage() {
  const ctx = await getWorkspaceContext();
  const [items, summary] = await Promise.all([listScanJobs(ctx), scanQueueSummary(ctx)]);
  return <ScansView initial={items} initialSummary={summary} />;
}
