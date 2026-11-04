import { getWorkspaceContext } from "@/lib/auth/session";
import { listProfiles } from "@/lib/score/service";
import { ScoringView } from "@/components/settings/scoring-view";

export const dynamic = "force-dynamic";

export default async function ScoringPage() {
  const ctx = await getWorkspaceContext();
  const profiles = await listProfiles(ctx.workspaceId);
  const active = profiles.find((profile) => profile.isActive) ?? null;
  return (
    <ScoringView
      initial={{
        active: active
          ? {
              id: active.id,
              name: active.name,
              version: active.version,
              isActive: active.isActive,
              config: active.config,
              createdAt: active.createdAt.toISOString(),
            }
          : null,
        profiles: profiles.map((profile) => ({
          id: profile.id,
          name: profile.name,
          version: profile.version,
          isActive: profile.isActive,
          config: profile.config,
          createdAt: profile.createdAt.toISOString(),
        })),
      }}
      timezone={ctx.timezone}
    />
  );
}
