import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ScoreComponents, ScoreConfig } from "@/lib/score/types";

/* ────────────────────────────── enums ────────────────────────────── */

export const memberRoleEnum = pgEnum("member_role", ["owner", "member"]);
export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "reviewing",
  "qualified",
  "contacted",
  "follow_up",
  "proposal_sent",
  "won",
  "lost",
  "do_not_contact",
]);
export const sourceTypeEnum = pgEnum("source_type", [
  "import",
  "discovery",
  "osm",
  "google_places",
  "demo",
  "manual",
]);
export const contactTypeEnum = pgEnum("contact_type", [
  "email",
  "phone",
  "whatsapp",
  "social",
  "contact_form",
  "booking",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);
export const scanOutcomeEnum = pgEnum("scan_outcome", [
  "success",
  "partial",
  "blocked_by_robots",
  "unreachable",
  "timeout",
  "tls_error",
  "non_html",
  "rejected_url",
  "cancelled",
  "error",
]);
export const chatbotResultEnum = pgEnum("chatbot_result", ["detected", "not_detected", "unknown"]);
export const confidenceEnum = pgEnum("confidence", ["high", "medium", "low"]);
export const duplicateStatusEnum = pgEnum("duplicate_status", [
  "pending",
  "merged",
  "kept_separate",
  "skipped",
]);
export const importOriginEnum = pgEnum("import_origin", ["import", "discovery"]);
export const activityTypeEnum = pgEnum("activity_type", [
  "created",
  "updated",
  "status_changed",
  "note_added",
  "scan_queued",
  "scan_completed",
  "score_recalculated",
  "imported",
  "merged",
  "export_ready",
  "follow_up_changed",
  "owner_changed",
  "tag_added",
  "tag_removed",
  "contact_verified",
]);

/* ──────────────────────── auth (Better Auth) ─────────────────────── */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("session_token_uq").on(t.token), index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ───────────────────────────── workspaces ────────────────────────── */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  isDemo: boolean("is_demo").notNull().default(false),
  timezone: text("timezone").notNull().default("UTC"),
  countryNotes: jsonb("country_notes").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_ws_user_uq").on(t.workspaceId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/* ────────────────────────────── leads ────────────────────────────── */

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    category: text("category"),
    categoryKey: text("category_key"),
    phone: text("phone"),
    phoneE164: text("phone_e164"),
    email: text("email"),
    emailNormalized: text("email_normalized"),
    websiteUrl: text("website_url"),
    websiteHost: text("website_host"),
    street: text("street"),
    area: text("area"),
    city: text("city"),
    country: text("country"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    status: leadStatusEnum("status").notNull().default("new"),
    ownerId: text("owner_id").references(() => user.id, { onDelete: "set null" }),
    doNotContact: boolean("do_not_contact").notNull().default(false),
    followUpAt: timestamp("follow_up_at", { withTimezone: true }),
    notes: text("notes"),
    fieldLocks: jsonb("field_locks").$type<string[]>().notNull().default([]),
    latestScore: integer("latest_score"),
    latestScoreResultId: uuid("latest_score_result_id"),
    latestScanId: uuid("latest_scan_id"),
    latestScanOutcome: scanOutcomeEnum("latest_scan_outcome"),
    latestChatbotResult: chatbotResultEnum("latest_chatbot_result"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    isDemo: boolean("is_demo").notNull().default(false),
    mergedIntoId: uuid("merged_into_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("businesses_ws_idx").on(t.workspaceId),
    index("businesses_ws_city_idx").on(t.workspaceId, t.city),
    index("businesses_ws_category_idx").on(t.workspaceId, t.categoryKey),
    index("businesses_ws_status_idx").on(t.workspaceId, t.status),
    index("businesses_ws_score_idx").on(t.workspaceId, t.latestScore),
    index("businesses_ws_checked_idx").on(t.workspaceId, t.lastCheckedAt),
    index("businesses_ws_name_idx").on(t.workspaceId, t.normalizedName),
    index("businesses_ws_host_idx").on(t.workspaceId, t.websiteHost),
    index("businesses_ws_phone_idx").on(t.workspaceId, t.phoneE164),
    index("businesses_ws_merged_idx").on(t.workspaceId, t.mergedIntoId),
  ],
);

export const businessLocations = pgTable(
  "business_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    street: text("street"),
    area: text("area"),
    city: text("city"),
    country: text("country"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    formattedAddress: text("formatted_address"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("locations_ws_business_idx").on(t.workspaceId, t.businessId)],
);

export const sourceRecords = pgTable(
  "source_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    source: sourceTypeEnum("source").notNull(),
    sourceId: text("source_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    attribution: text("attribution"),
    importJobId: uuid("import_job_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("source_records_ws_source_uq").on(t.workspaceId, t.source, t.sourceId),
    index("source_records_business_idx").on(t.businessId),
  ],
);

export const contactPoints = pgTable(
  "contact_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    type: contactTypeEnum("type").notNull(),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    label: text("label"),
    platform: text("platform"),
    verifiedByUser: boolean("verified_by_user").notNull().default(false),
    confidence: confidenceEnum("confidence").notNull().default("medium"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_points_unique").on(t.businessId, t.type, t.normalizedValue),
    index("contact_points_ws_idx").on(t.workspaceId, t.type),
    index("contact_points_ws_business_idx").on(t.workspaceId, t.businessId),
  ],
);

/* ───────────────────────────── imports ───────────────────────────── */

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    origin: importOriginEnum("origin").notNull().default("import"),
    filename: text("filename").notNull(),
    fileHash: text("file_hash"),
    mappingHash: text("mapping_hash"),
    idempotencyKey: text("idempotency_key"),
    storagePath: text("storage_path"),
    // Base64 copy of the uploaded file when running without a persistent disk
    // (Vercel/serverless). Cleared once the import has finished successfully.
    fileData: text("file_data"),
    mapping: jsonb("mapping").$type<Record<string, string>>(),
    detectedColumns: jsonb("detected_columns").$type<string[]>(),
    status: jobStatusEnum("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    processedRows: integer("processed_rows").notNull().default(0),
    rowCount: integer("row_count").notNull().default(0),
    validCount: integer("valid_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    mergedCount: integer("merged_count").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    mappingConfirmed: boolean("mapping_confirmed").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("import_jobs_ws_created_idx").on(t.workspaceId, t.createdAt),
    uniqueIndex("import_jobs_idempotency_uq").on(t.workspaceId, t.idempotencyKey),
  ],
);

export const importRowErrors = pgTable(
  "import_row_errors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    importJobId: uuid("import_job_id")
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    reason: text("reason").notNull(),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_row_errors_job_idx").on(t.importJobId)],
);

/* ────────────────────────────── scans ────────────────────────────── */

export const scanJobs = pgTable(
  "scan_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    outcome: scanOutcomeEnum("outcome"),
    progress: integer("progress").notNull().default(0),
    pagesTotal: integer("pages_total").notNull().default(0),
    pagesDone: integer("pages_done").notNull().default(0),
    force: boolean("force").notNull().default(false),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("scan_jobs_ws_status_idx").on(t.workspaceId, t.status),
    index("scan_jobs_business_idx").on(t.businessId, t.createdAt),
  ],
);

export const scanResults = pgTable(
  "scan_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => scanJobs.id, { onDelete: "set null" }),
    outcome: scanOutcomeEnum("outcome").notNull(),
    chatbotResult: chatbotResultEnum("chatbot_result").notNull().default("unknown"),
    chatWidgets: jsonb("chat_widgets").$type<unknown[]>().notNull().default([]),
    platform: text("platform"),
    platformConfidence: confidenceEnum("platform_confidence"),
    title: text("title"),
    lang: text("lang"),
    httpStatus: integer("http_status"),
    finalUrl: text("final_url"),
    pagesScanned: integer("pages_scanned").notNull().default(0),
    pagesSkipped: integer("pages_skipped").notNull().default(0),
    confidence: confidenceEnum("confidence").notNull().default("low"),
    pageDetails: jsonb("page_details").$type<unknown[]>().notNull().default([]),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scan_results_ws_business_idx").on(t.workspaceId, t.businessId, t.createdAt),
    index("scan_results_job_idx").on(t.jobId),
  ],
);

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    contactPointId: uuid("contact_point_id").references(() => contactPoints.id, { onDelete: "set null" }),
    scanResultId: uuid("scan_result_id").references(() => scanResults.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    originalValue: text("original_value").notNull(),
    normalizedValue: text("normalized_value"),
    sourceUrl: text("source_url").notNull(),
    method: text("method").notNull(),
    confidence: confidenceEnum("confidence").notNull().default("medium"),
    verificationStatus: text("verification_status").notNull().default("unverified"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("evidence_ws_business_idx").on(t.workspaceId, t.businessId),
    index("evidence_scan_idx").on(t.scanResultId),
    uniqueIndex("evidence_unique").on(t.businessId, t.type, t.originalValue, t.sourceUrl),
  ],
);

/* ───────────────────────────── scoring ───────────────────────────── */

export const scoreProfiles = pgTable(
  "score_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    isActive: boolean("is_active").notNull().default(false),
    config: jsonb("config").$type<ScoreConfig>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("score_profiles_ws_name_version_uq").on(t.workspaceId, t.name, t.version),
    index("score_profiles_ws_active_idx").on(t.workspaceId, t.isActive),
  ],
);

export const scoreResults = pgTable(
  "score_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => scoreProfiles.id, { onDelete: "cascade" }),
    profileVersion: integer("profile_version").notNull(),
    total: integer("total").notNull(),
    components: jsonb("components").$type<ScoreComponents>().notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("score_results_ws_business_idx").on(t.workspaceId, t.businessId, t.calculatedAt),
    index("score_results_profile_idx").on(t.profileId),
  ],
);

/* ─────────────────────── notes, tags, activity ───────────────────── */

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorId: text("author_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notes_ws_business_idx").on(t.workspaceId, t.businessId, t.createdAt)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("primary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tags_ws_name_uq").on(t.workspaceId, t.name)],
);

export const businessTags = pgTable(
  "business_tags",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("business_tags_uq").on(t.businessId, t.tagId),
    index("business_tags_ws_idx").on(t.workspaceId, t.tagId),
  ],
);

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessId: uuid("business_id").references(() => businesses.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_ws_business_idx").on(t.workspaceId, t.businessId, t.createdAt),
    index("activities_ws_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

/* ─────────────────────────── duplicates ─────────────────────────── */

export const duplicateCandidates = pgTable(
  "duplicate_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    businessAId: uuid("business_a_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    businessBId: uuid("business_b_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    similarity: doublePrecision("similarity").notNull().default(0),
    distanceM: doublePrecision("distance_m"),
    reasons: jsonb("reasons").$type<string[]>().notNull().default([]),
    status: duplicateStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("duplicate_pair_uq").on(t.workspaceId, t.businessAId, t.businessBId),
    index("duplicate_ws_status_idx").on(t.workspaceId, t.status),
  ],
);

export const mergeHistory = pgTable(
  "merge_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    keptBusinessId: uuid("kept_business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    mergedBusinessId: uuid("merged_business_id").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
  },
  (t) => [index("merge_history_ws_idx").on(t.workspaceId, t.createdAt)],
);

/* ─────────────────── saved views / category map ──────────────────── */

export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    query: jsonb("query").$type<Record<string, string>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_views_ws_user_idx").on(t.workspaceId, t.userId)],
);

export const categoryMappings = pgTable(
  "category_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rawPattern: text("raw_pattern").notNull(),
    categoryKey: text("category_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("category_map_ws_pattern_uq").on(t.workspaceId, t.rawPattern)],
);

/* ─────────────────────── exports & discovery ────────────────────── */

export const exportJobs = pgTable(
  "export_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    status: jobStatusEnum("status").notNull().default("queued"),
    filters: jsonb("filters").$type<Record<string, string>>().notNull().default({}),
    includeNotes: boolean("include_notes").notNull().default(false),
    includeDnc: boolean("include_dnc").notNull().default(false),
    rowCount: integer("row_count").notNull().default(0),
    storagePath: text("storage_path"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("export_jobs_ws_idx").on(t.workspaceId, t.createdAt)],
);

export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    country: text("country").notNull(),
    city: text("city").notNull(),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    limitCount: integer("limit_count").notNull().default(50),
    enabled: boolean("enabled").notNull().default(false),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_searches_ws_idx").on(t.workspaceId)],
);

/* ──────────────────────────── relations ─────────────────────────── */

export const businessRelations = relations(businesses, ({ many, one }) => ({
  contacts: many(contactPoints),
  sources: many(sourceRecords),
  evidence: many(evidenceRecords),
  scores: many(scoreResults),
  scans: many(scanResults),
  tags: many(businessTags),
  workspace: one(workspaces, { fields: [businesses.workspaceId], references: [workspaces.id] }),
}));

export const contactRelations = relations(contactPoints, ({ one }) => ({
  business: one(businesses, { fields: [contactPoints.businessId], references: [businesses.id] }),
}));

export const workspaceRelations = relations(workspaces, ({ many }) => ({
  memberships: many(memberships),
  businesses: many(businesses),
}));

// Silence unused import warning for sql (kept for future expression indexes).
void sql;
