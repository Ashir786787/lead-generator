import { notFound } from "next/navigation";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getLeadDetail } from "@/lib/data/leads";
import { LeadDetailView } from "@/components/leads/lead-detail";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getWorkspaceContext();
  const detail = await getLeadDetail(ctx, id).catch(() => null);
  if (!detail) notFound();
  return <LeadDetailView initial={detail} timezone={ctx.timezone} />;
}
