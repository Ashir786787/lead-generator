import type { Db } from "mongodb";
import { collections } from "./index";

/**
 * Idempotent index creation. Run by `pnpm db:migrate` and by the demo seeder,
 * never on the request path: serverless cold starts should not pay for DDL.
 */
export async function ensureIndexes(db: Db = collections.businesses.db): Promise<void> {
  await Promise.all([
    // ── auth ──────────────────────────────────────────────────────────
    db.collection("user").createIndex({ email: 1 }, { unique: true }),
    db.collection("session").createIndex({ token: 1 }, { unique: true }),
    db.collection("session").createIndex({ userId: 1 }),
    db.collection("account").createIndex({ userId: 1 }),
    db.collection("verification").createIndex({ identifier: 1 }),

    // ── workspaces ────────────────────────────────────────────────────
    db.collection("workspaces").createIndex({ slug: 1 }, { unique: true }),
    db
      .collection("memberships")
      .createIndex({ workspaceId: 1, userId: 1 }, { unique: true }),
    db.collection("memberships").createIndex({ userId: 1 }),

    // ── leads ─────────────────────────────────────────────────────────
    db.collection("businesses").createIndex({ workspaceId: 1, createdAt: -1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, city: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, categoryKey: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, status: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, latestScore: -1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, lastCheckedAt: -1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, normalizedName: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, websiteHost: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, phoneE164: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, mergedIntoId: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, nameTokens: 1 }),
    db.collection("businesses").createIndex({ workspaceId: 1, hasWhatsapp: 1 }),
    db
      .collection("business_locations")
      .createIndex({ workspaceId: 1, businessId: 1 }),
    db
      .collection("source_records")
      .createIndex(
        { workspaceId: 1, source: 1, sourceId: 1 },
        { unique: true },
      ),
    db.collection("source_records").createIndex({ businessId: 1 }),
    db
      .collection("contact_points")
      .createIndex(
        { businessId: 1, type: 1, normalizedValue: 1 },
        { unique: true },
      ),
    db.collection("contact_points").createIndex({ workspaceId: 1, type: 1 }),
    db.collection("contact_points").createIndex({ workspaceId: 1, businessId: 1 }),

    // ── imports ───────────────────────────────────────────────────────
    db.collection("import_jobs").createIndex({ workspaceId: 1, createdAt: -1 }),
    db
      .collection("import_jobs")
      .createIndex(
        { workspaceId: 1, idempotencyKey: 1 },
        { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
      ),
    db.collection("import_row_errors").createIndex({ importJobId: 1 }),

    // ── scans ─────────────────────────────────────────────────────────
    db.collection("scan_jobs").createIndex({ workspaceId: 1, status: 1 }),
    db.collection("scan_jobs").createIndex({ businessId: 1, createdAt: -1 }),
    db
      .collection("scan_results")
      .createIndex({ workspaceId: 1, businessId: 1, createdAt: -1 }),
    db.collection("scan_results").createIndex({ jobId: 1 }),
    db
      .collection("evidence_records")
      .createIndex({ workspaceId: 1, businessId: 1 }),
    db.collection("evidence_records").createIndex({ scanResultId: 1 }),
    db
      .collection("evidence_records")
      .createIndex(
        { businessId: 1, type: 1, originalValue: 1, sourceUrl: 1 },
        { unique: true },
      ),

    // ── scoring ───────────────────────────────────────────────────────
    db
      .collection("score_profiles")
      .createIndex(
        { workspaceId: 1, name: 1, version: 1 },
        { unique: true },
      ),
    db.collection("score_profiles").createIndex({ workspaceId: 1, isActive: 1 }),
    db
      .collection("score_results")
      .createIndex({ workspaceId: 1, businessId: 1, calculatedAt: -1 }),
    db.collection("score_results").createIndex({ profileId: 1 }),

    // ── notes / tags / activity ───────────────────────────────────────
    db
      .collection("notes")
      .createIndex({ workspaceId: 1, businessId: 1, createdAt: -1 }),
    db.collection("tags").createIndex({ workspaceId: 1, name: 1 }, { unique: true }),
    db
      .collection("business_tags")
      .createIndex({ businessId: 1, tagId: 1 }, { unique: true }),
    db.collection("business_tags").createIndex({ workspaceId: 1, tagId: 1 }),
    db
      .collection("activities")
      .createIndex({ workspaceId: 1, businessId: 1, createdAt: -1 }),
    db.collection("activities").createIndex({ workspaceId: 1, createdAt: -1 }),

    // ── duplicates ────────────────────────────────────────────────────
    db
      .collection("duplicate_candidates")
      .createIndex(
        { workspaceId: 1, businessAId: 1, businessBId: 1 },
        { unique: true },
      ),
    db.collection("duplicate_candidates").createIndex({ workspaceId: 1, status: 1 }),
    db
      .collection("merge_history")
      .createIndex({ workspaceId: 1, createdAt: -1 }),

    // ── views / mappings / exports / discovery ────────────────────────
    db.collection("saved_views").createIndex({ workspaceId: 1, userId: 1 }),
    db
      .collection("category_mappings")
      .createIndex({ workspaceId: 1, rawPattern: 1 }, { unique: true }),
    db.collection("export_jobs").createIndex({ workspaceId: 1, createdAt: -1 }),
    db.collection("saved_searches").createIndex({ workspaceId: 1 }),

    // ── live events: expire after one hour ────────────────────────────
    db
      .collection("live_events")
      .createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 }),
    db.collection("live_events").createIndex({ workspaceId: 1, createdAt: 1 }),
  ]);
}
