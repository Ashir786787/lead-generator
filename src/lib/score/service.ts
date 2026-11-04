import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  businesses,
  contactPoints,
  scanResults,
  scoreProfiles,
  scoreResults,
} from "@/lib/db/schema";
import { computeScore, type ScoreInput } from "./engine";
import { cloneDefaultConfig, validateScoreConfig } from "./config";
import type { ScoreConfig } from "./types";

export const PROFILE_NAME = "AI Chatbot Opportunity";

export async function ensureDefaultProfile(workspaceId: string, actorId?: string | null) {
  const [existing] = await db
    .select()
    .from(scoreProfiles)
    .where(and(eq(scoreProfiles.workspaceId, workspaceId), eq(scoreProfiles.isActive, true)))
    .orderBy(desc(scoreProfiles.version))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(scoreProfiles)
    .values({
      workspaceId,
      name: PROFILE_NAME,
      version: 1,
      isActive: true,
      config: cloneDefaultConfig(),
      createdBy: actorId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [fallback] = await db
    .select()
    .from(scoreProfiles)
    .where(eq(scoreProfiles.workspaceId, workspaceId))
    .orderBy(desc(scoreProfiles.version))
    .limit(1);
  if (!fallback) throw new Error("Could not create the default score profile.");
  return fallback;
}

export async function getActiveProfile(workspaceId: string) {
  const [row] = await db
    .select()
    .from(scoreProfiles)
    .where(and(eq(scoreProfiles.workspaceId, workspaceId), eq(scoreProfiles.isActive, true)))
    .orderBy(desc(scoreProfiles.version))
    .limit(1);
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
  const [business] = await db
    .select({ id: businesses.id, categoryKey: businesses.categoryKey })
    .from(businesses)
    .where(and(eq(businesses.workspaceId, workspaceId), eq(businesses.id, businessId)))
    .limit(1);
  if (!business) return null;

  const [profile, scans, contacts] = await Promise.all([
    getActiveProfile(workspaceId),
    db
      .select()
      .from(scanResults)
      .where(and(eq(scanResults.workspaceId, workspaceId), eq(scanResults.businessId, businessId)))
      .orderBy(desc(scanResults.createdAt))
      .limit(1),
    db
      .select({ type: contactPoints.type, normalizedValue: contactPoints.normalizedValue })
      .from(contactPoints)
      .where(and(eq(contactPoints.workspaceId, workspaceId), eq(contactPoints.businessId, businessId))),
  ]);

  const scanRow = scans[0];
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
    profileId: profile.id,
    profileVersion: profile.version,
  });

  const [inserted] = await db
    .insert(scoreResults)
    .values({
      workspaceId,
      businessId,
      profileId: profile.id,
      profileVersion: profile.version,
      total: output.total,
      components: output.components,
      calculatedAt: new Date(output.calculatedAt),
    })
    .returning({ id: scoreResults.id });

  if (!inserted) return null;

  await db
    .update(businesses)
    .set({
      latestScore: output.total,
      latestScoreResultId: inserted.id,
      updatedAt: new Date(),
    })
    .where(and(eq(businesses.workspaceId, workspaceId), eq(businesses.id, businessId)));

  return {
    resultId: inserted.id,
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
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.workspaceId, workspaceId), isNull(businesses.mergedIntoId)));
  let done = 0;
  for (const row of rows) {
    await recalculateLeadScore(workspaceId, row.id);
    done++;
    if (onProgress && done % 25 === 0) await onProgress(done, rows.length);
  }
  if (onProgress) await onProgress(done, rows.length);
  return { done, total: rows.length };
}

export async function listProfiles(workspaceId: string) {
  return db
    .select({
      id: scoreProfiles.id,
      name: scoreProfiles.name,
      version: scoreProfiles.version,
      isActive: scoreProfiles.isActive,
      config: scoreProfiles.config,
      createdAt: scoreProfiles.createdAt,
    })
    .from(scoreProfiles)
    .where(eq(scoreProfiles.workspaceId, workspaceId))
    .orderBy(desc(scoreProfiles.createdAt));
}

export async function createProfileVersion(
  workspaceId: string,
  config: ScoreConfig,
  actorId: string | null,
  name = PROFILE_NAME,
) {
  const validated = validateScoreConfig(config);
  const [current] = await db
    .select({ value: max(scoreProfiles.version) })
    .from(scoreProfiles)
    .where(and(eq(scoreProfiles.workspaceId, workspaceId), eq(scoreProfiles.name, name)));
  const nextVersion = Number(current?.value ?? 0) + 1;

  const [created] = await db.transaction(async (tx) => {
    await tx
      .update(scoreProfiles)
      .set({ isActive: false })
      .where(eq(scoreProfiles.workspaceId, workspaceId));
    return tx
      .insert(scoreProfiles)
      .values({
        workspaceId,
        name,
        version: nextVersion,
        isActive: true,
        config: validated,
        createdBy: actorId,
      })
      .returning();
  });
  if (!created) throw new Error("Could not save the score profile.");
  return created;
}

export async function activateProfile(workspaceId: string, profileId: string) {
  const [profile] = await db
    .select({ id: scoreProfiles.id })
    .from(scoreProfiles)
    .where(and(eq(scoreProfiles.workspaceId, workspaceId), eq(scoreProfiles.id, profileId)))
    .limit(1);
  if (!profile) throw new Error("Profile not found");
  await db.transaction(async (tx) => {
    await tx.update(scoreProfiles).set({ isActive: false }).where(eq(scoreProfiles.workspaceId, workspaceId));
    await tx.update(scoreProfiles).set({ isActive: true }).where(eq(scoreProfiles.id, profileId));
  });
}

export async function previewProfileImpact(workspaceId: string, config: ScoreConfig) {
  const validated = validateScoreConfig(config);
  const rows = await db
    .select({
      id: businesses.id,
      categoryKey: businesses.categoryKey,
      latestScore: businesses.latestScore,
    })
    .from(businesses)
    .where(and(eq(businesses.workspaceId, workspaceId), isNull(businesses.mergedIntoId)))
    .limit(500);

  let changed = 0;
  let deltaSum = 0;
  for (const row of rows) {
    const scan = await db
      .select({
        outcome: scanResults.outcome,
        chatbotResult: scanResults.chatbotResult,
        chatWidgets: scanResults.chatWidgets,
        confidence: scanResults.confidence,
        summary: scanResults.summary,
      })
      .from(scanResults)
      .where(and(eq(scanResults.workspaceId, workspaceId), eq(scanResults.businessId, row.id)))
      .orderBy(desc(scanResults.createdAt))
      .limit(1);
    const contacts = await db
      .select({ type: contactPoints.type, normalizedValue: contactPoints.normalizedValue })
      .from(contactPoints)
      .where(and(eq(contactPoints.workspaceId, workspaceId), eq(contactPoints.businessId, row.id)));
    const output = computeScore(
      buildInput({ categoryKey: row.categoryKey }, scan[0] ?? null, contacts),
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
  const [row] = await db
    .select({ total: scoreResults.total })
    .from(scoreResults)
    .where(and(eq(scoreResults.workspaceId, workspaceId), eq(scoreResults.businessId, businessId)))
    .orderBy(desc(scoreResults.calculatedAt))
    .limit(1);
  return row?.total ?? null;
}

void sql;
