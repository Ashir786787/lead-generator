import { getWorkspaceContext } from "@/lib/auth/session";
import { listDuplicatePairs } from "@/lib/dedupe/service";
import { DuplicatesView } from "@/components/duplicates/duplicates-view";

export const dynamic = "force-dynamic";

export default async function DuplicatesPage() {
  const ctx = await getWorkspaceContext();
  const items = await listDuplicatePairs(ctx);
  return <DuplicatesView initial={items} />;
}
