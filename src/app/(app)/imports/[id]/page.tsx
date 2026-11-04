import { notFound } from "next/navigation";
import { getWorkspaceContext } from "@/lib/auth/session";
import { getImport } from "@/lib/import/service";
import { ImportDetailView } from "@/components/imports/import-detail";

export const dynamic = "force-dynamic";

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getWorkspaceContext();
  const detail = await getImport(ctx, id).catch(() => null);
  if (!detail) notFound();
  return <ImportDetailView initial={detail} timezone={ctx.timezone} />;
}
