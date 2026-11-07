import { collections, newId, now, withTransaction } from "@/lib/db";
import type { ScoreProfileDoc, ScanResultDoc, ContactPointDoc } from "@/lib/db/types";
import { computeScore, type ScoreInput } from "./engine";
import { cloneDefaultConfig, validateScoreConfig } from "./config";
import type { ScoreConfig } from "./types";

export const PROFILE_NAME = "AI Chatbot Opportunity";

export async function ensureDefaultProfile(
  workspaceId: string,
  actorId?: string | null,
): Promise<ScoreProfileDoc> {
  const existing = await collections.scoreProfiles.findOne(
    { workspaceId, isActive: true },
    { sort: { version: -1 } },
  );
  if (existing) return existing;

  const profile: ScoreProfileDoc = {
    _id: newId(),
    workspaceId,
    name: PROFILE_NAME,
    version: 1,
    isActive: true,
    config: cloneDefaultConfig(),
    createdAt: now(),
    createdBy: actorId ?? null,
  };
  try {
    await collections.scoreProfiles.insertOne(profile);
    return profile;
  } catch {
    // Another request created it concurrently.
  }

  const fallback = await collections.scoreProfiles.findOne(
    { workspaceId },
    { sort: { version: -1 } },
  );
  if (!fallback) throw new Error("Could not create the default score profile.");
  return fallback;
}

export async function getActiveProfile(workspaceId: string): Promise<ScoreProfileDoc> {
  const row = await collections.scoreProfiles.findOne(
    { workspaceId, isActive: true },
    { sort: { version: -1 } },
  );
  return row ?? ensureDefaultProfile(workspaceId);
}

function buildInput(
  business: { categoryKey: string | null },
  scan:
    | {
        outcome: string;
        chatbotResult: string;
        chatWidgets: unknown[];
        confidence: string | null;
        summary: Record<string, unknown> | null;
      }
    | null,
  contacts: Array<{ type: string; normalizedValue: string }>,
): ScoreInput {
  const summary = scan?.summary ?? {};
  return {
    categoryKey: business.categoryKey,
    scan,
    contacts,
    hasExplicitWhatsapp: contacts.some((contact) => contact.type === "whatsapp"),
    hasBooking:
      contacts.some((contact) => contact.type === "booking") || summary.booking === true,
    hasInquiryForm: summary.inquiryForm === true,
  };
}

export interface RecalculatedScore {
  resultId: string;
  total: number;
  components: ReturnType<typeof computeScore>["components"];
  profileVersion: number;
  calculatedAt: string;
}

export async function recalculateLeadScore(
  workspaceId: string,
  businessId: string,
): Promise<RecalculatedScore | null> {
  const business = await collections.businesses.findOne(
    { workspaceId, _id: businessId },
    { projection: { _id: 1, categoryKey: 1 } },
  );
  if (!business) return null;

  const [profile, scanRow, contacts] = await Promise.all([
    getActiveProfile(workspaceId),
    collections.scanResults.findOne(
      { workspaceId, businessId },
      { sort: { createdAt: -1 } },
    ),
    collections.contactPoints
      .find(
        { workspaceId, businessId },
        { projection: { _id: 0, type: 1, normalizedValue: 1 } },
      )
      .toArray(),
  ]);

  const scan = scanRow
    ? {
        outcome: scanRow.outcome,
        chatbotResult: scanRow.chatbotResult,
        chatWidgets: scanRow.chatWidgets,
        confidence: scanRow.confidence,
        summary: scanRow.summary,
      }
    : null;

  const output = computeScore(buildInput(business, scan, contacts), profile.config, {
    profileId: profile._id,
    profileVersion: profile.version,
  });

  const resultId = newId();
  await collections.scoreResults.insertOne({
    _id: resultId,
    workspaceId,
    businessId,
    profileId: profile._id,
    profileVersion: profile.version,
    total: output.total,
    components: output.components,
    calculatedAt: new Date(output.calculatedAt),
  });

  await collections.businesses.updateOne(
    { workspaceId, _id: businessId },
    {
      $set: {
        latestScore: output.total,
        latestScoreResultId: resultId,
        updatedAt: now(),
      },
    },
  );

  return {
    resultId,
    total: output.total,
    components: output.components,
    profileVersion: profile.version,
    calculatedAt: output.calculatedAt,
  };
}

export async function recalculateWorkspaceScores(
  workspaceId: string,
  onProgress?: (done: number, total: number) => Promise<void> | void,
): Promise<{ done: number; total: number }> {
  const rows = await collections.businesses
    .find({ workspaceId, mergedIntoId: null }, { projection: { _id: 1 } })
    .toArray();
  let done = 0;
  for (const row of rows) {
    await recalculateLeadScore(workspaceId, row._id);
    done++;
    if (onProgress && done % 25 === 0) await onProgress(done, rows.length);
  }
  if (onProgress) await onProgress(done, rows.length);
  return { done, total: rows.length };
}

export async function listProfiles(workspaceId: string) {
  return collections.scoreProfiles
    .find(
      { workspaceId },
      { projection: { _id: 1, name: 1, version: 1, isActive: 1, config: 1, createdAt: 1 } },
    )
    .sort({ createdAt: -1 })
    .toArray();
}

export async function createProfileVersion(
  workspaceId: string,
  config: ScoreConfig,
  actorId: string | null,
  name = PROFILE_NAME,
): Promise<ScoreProfileDoc> {
  const validated = validateScoreConfig(config);
  const current = await collections.scoreProfiles.findOne(
    { workspaceId, name },
    { sort: { version: -1 }, projection: { version: 1 } },
  );
  const nextVersion = (current?.version ?? 0) + 1;

  const created: ScoreProfileDoc = {
    _id: newId(),
    workspaceId,
    name,
    version: nextVersion,
    isActive: true,
    config: validated,
    createdAt: now(),
    createdBy: actorId,
  };
  await withTransaction(async (session) => {
    await collections.scoreProfiles.updateMany(
      { workspaceId },
      { $set: { isActive: false } },
      { session },
    );
    await collections.scoreProfiles.insertOne(created, { session });
  });
  return created;
}

export async function activateProfile(workspaceId: string, profileId: string): Promise<void> {
  const profile = await collections.scoreProfiles.findOne(
    { workspaceId, _id: profileId },
    { projection: { _id: 1 } },
  );
  if (!profile) throw new Error("Profile not found");
  await withTransaction(async (session) => {
    await collections.scoreProfiles.updateMany(
      { workspaceId },
      { $set: { isActive: false } },
      { session },
    );
    await collections.scoreProfiles.updateOne(
      { _id: profileId },
      { $set: { isActive: true } },
      { session },
    );
  });
}

export async function previewProfileImpact(workspaceId: string, config: ScoreConfig) {
  const validated = validateScoreConfig(config);
  const rows = await collections.businesses
    .find(
      { workspaceId, mergedIntoId: null },
      { projection: { _id: 1, categoryKey: 1, latestScore: 1 } },
    )
    .limit(500)
    .toArray();

  let changed = 0;
  let deltaSum = 0;
  for (const row of rows) {
    const [scanRow, contacts] = await Promise.all([
      collections.scanResults.findOne(
        { workspaceId, businessId: row._id },
        {
          sort: { createdAt: -1 },
          projection: {
            _id: 0,
            outcome: 1,
            chatbotResult: 1,
            chatWidgets: 1,
            confidence: 1,
            summary: 1,
          },
        },
      ),
      collections.contactPoints
        .find(
          { workspaceId, businessId: row._id },
          { projection: { _id: 0, type: 1, normalizedValue: 1 } },
        )
        .toArray(),
    ]);
    const output = computeScore(
      buildInput(
        { categoryKey: row.categoryKey },
        scanRow as Pick<ScanResultDoc, "outcome" | "chatbotResult" | "chatWidgets" | "confidence" | "summary"> | null,
        contacts as Array<Pick<ContactPointDoc, "type" | "normalizedValue">>,
      ),
      validated,
      { profileId: "preview", profileVersion: 0 },
    );
    const delta = output.total - (row.latestScore ?? 0);
    if (delta !== 0) changed++;
    deltaSum += delta;
  }
  return {
    sampled: rows.length,
    changed,
    averageDelta: rows.length ? Math.round((deltaSum / rows.length) * 10) / 10 : 0,
  };
}

/** Used by the seed script to resolve the latest score quickly. */
export async function latestScoreFor(workspaceId: string, businessId: string): Promise<number | null> {
  const row = await collections.scoreResults.findOne(
    { workspaceId, businessId },
    { sort: { calculatedAt: -1 }, projection: { total: 1 } },
  );
  return row?.total ?? null;
}
