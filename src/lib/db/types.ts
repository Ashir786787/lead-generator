import type { ScoreComponents, ScoreConfig } from "@/lib/score/types";
import type { PipelineStatus } from "@/lib/constants";

/* ────────────────────────────── enums ────────────────────────────── */

export type MemberRole = "owner" | "member";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export type SourceType = "import" | "discovery" | "osm" | "google_places" | "demo" | "manual";

export type ContactType = "email" | "phone" | "whatsapp" | "social" | "contact_form" | "booking";

export type ScanOutcome =
  | "success"
  | "partial"
  | "blocked_by_robots"
  | "unreachable"
  | "timeout"
  | "tls_error"
  | "non_html"
  | "rejected_url"
  | "cancelled"
  | "error";

export type ChatbotResult = "detected" | "not_detected" | "unknown";

export type Confidence = "high" | "medium" | "low";

export type DuplicateStatus = "pending" | "merged" | "kept_separate" | "skipped";

export type ImportOrigin = "import" | "discovery";

export type ActivityType =
  | "created"
  | "updated"
  | "status_changed"
  | "note_added"
  | "scan_queued"
  | "scan_completed"
  | "score_recalculated"
  | "imported"
  | "merged"
  | "export_ready"
  | "follow_up_changed"
  | "owner_changed"
  | "tag_added"
  | "tag_removed"
  | "contact_verified";

/* ──────────────────────── auth (Better Auth) ─────────────────────── */

export interface UserDoc {
  _id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionDoc {
  _id: string;
  expiresAt: Date;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  userId: string;
}

export interface AccountDoc {
  _id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: string | null;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
  scope: string | null;
  password: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VerificationDoc {
  _id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/* ───────────────────────────── workspaces ────────────────────────── */

export interface WorkspaceDoc {
  _id: string;
  name: string;
  slug: string;
  isDemo: boolean;
  timezone: string;
  countryNotes: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface MembershipDoc {
  _id: string;
  workspaceId: string;
  userId: string;
  role: MemberRole;
  createdAt: Date;
}

/* ────────────────────────────── leads ────────────────────────────── */

export interface BusinessDoc {
  _id: string;
  workspaceId: string;
  name: string;
  normalizedName: string;
  nameTokens: string[];
  category: string | null;
  categoryKey: string | null;
  phone: string | null;
  phoneE164: string | null;
  email: string | null;
  emailNormalized: string | null;
  websiteUrl: string | null;
  websiteHost: string | null;
  street: string | null;
  area: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  status: PipelineStatus;
  ownerId: string | null;
  doNotContact: boolean;
  followUpAt: Date | null;
  notes: string | null;
  fieldLocks: string[];
  latestScore: number | null;
  latestScoreResultId: string | null;
  latestScanId: string | null;
  latestScanOutcome: ScanOutcome | null;
  latestChatbotResult: ChatbotResult | null;
  lastCheckedAt: Date | null;
  isDemo: boolean;
  /** Denormalized contact flag so list filters never need a join. */
  hasWhatsapp: boolean;
  mergedIntoId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BusinessLocationDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  street: string | null;
  area: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  formattedAddress: string | null;
  isPrimary: boolean;
  createdAt: Date;
}

export interface SourceRecordDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  source: SourceType;
  sourceId: string;
  payload: Record<string, unknown> | null;
  attribution: string | null;
  importJobId: string | null;
  createdAt: Date;
}

export interface ContactPointDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  type: ContactType;
  value: string;
  normalizedValue: string;
  label: string | null;
  platform: string | null;
  verifiedByUser: boolean;
  confidence: Confidence;
  firstSeenAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}

/* ───────────────────────────── imports ───────────────────────────── */

export interface ImportJobDoc {
  _id: string;
  workspaceId: string;
  createdBy: string | null;
  origin: ImportOrigin;
  filename: string;
  fileHash: string | null;
  mappingHash: string | null;
  idempotencyKey: string | null;
  storagePath: string | null;
  mapping: Record<string, string> | null;
  detectedColumns: string[] | null;
  status: JobStatus;
  progress: number;
  processedRows: number;
  rowCount: number;
  validCount: number;
  newCount: number;
  duplicateCount: number;
  mergedCount: number;
  reviewCount: number;
  skippedCount: number;
  errorCount: number;
  mappingConfirmed: boolean;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ImportRowErrorDoc {
  _id: string;
  workspaceId: string;
  importJobId: string;
  rowNumber: number;
  reason: string;
  raw: Record<string, unknown> | null;
  createdAt: Date;
}

/* ────────────────────────────── scans ────────────────────────────── */

export interface ScanJobDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  requestedBy: string | null;
  status: JobStatus;
  outcome: ScanOutcome | null;
  progress: number;
  pagesTotal: number;
  pagesDone: number;
  force: boolean;
  cancelRequested: boolean;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ScanResultDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  jobId: string | null;
  outcome: ScanOutcome;
  chatbotResult: ChatbotResult;
  chatWidgets: unknown[];
  platform: string | null;
  platformConfidence: Confidence | null;
  title: string | null;
  lang: string | null;
  httpStatus: number | null;
  finalUrl: string | null;
  pagesScanned: number;
  pagesSkipped: number;
  confidence: Confidence;
  pageDetails: unknown[];
  summary: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface EvidenceRecordDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  contactPointId: string | null;
  scanResultId: string | null;
  type: string;
  originalValue: string;
  normalizedValue: string | null;
  sourceUrl: string;
  method: string;
  confidence: Confidence;
  verificationStatus: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/* ───────────────────────────── scoring ───────────────────────────── */

export interface ScoreProfileDoc {
  _id: string;
  workspaceId: string;
  name: string;
  version: number;
  isActive: boolean;
  config: ScoreConfig;
  createdAt: Date;
  createdBy: string | null;
}

export interface ScoreResultDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  profileId: string;
  profileVersion: number;
  total: number;
  components: ScoreComponents;
  calculatedAt: Date;
}

/* ─────────────────────── notes, tags, activity ───────────────────── */

export interface NoteDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  body: string;
  authorId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TagDoc {
  _id: string;
  workspaceId: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface BusinessTagDoc {
  _id: string;
  workspaceId: string;
  businessId: string;
  tagId: string;
}

export interface ActivityDoc {
  _id: string;
  workspaceId: string;
  businessId: string | null;
  type: ActivityType;
  message: string;
  metadata: Record<string, unknown> | null;
  actorId: string | null;
  createdAt: Date;
}

/* ─────────────────────────── duplicates ─────────────────────────── */

export interface DuplicateCandidateDoc {
  _id: string;
  workspaceId: string;
  businessAId: string;
  businessBId: string;
  similarity: number;
  distanceM: number | null;
  reasons: string[];
  status: DuplicateStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
}

export interface MergeHistoryDoc {
  _id: string;
  workspaceId: string;
  keptBusinessId: string;
  mergedBusinessId: string;
  snapshot: Record<string, unknown>;
  actorId: string | null;
  createdAt: Date;
  undoneAt: Date | null;
}

/* ─────────────────── saved views / category map ──────────────────── */

export interface SavedViewDoc {
  _id: string;
  workspaceId: string;
  userId: string;
  name: string;
  query: Record<string, string>;
  createdAt: Date;
}

export interface CategoryMappingDoc {
  _id: string;
  workspaceId: string;
  rawPattern: string;
  categoryKey: string;
  createdAt: Date;
}

/* ─────────────────────── exports & discovery ────────────────────── */

export interface ExportJobDoc {
  _id: string;
  workspaceId: string;
  createdBy: string | null;
  status: JobStatus;
  filters: Record<string, string>;
  includeNotes: boolean;
  includeDnc: boolean;
  rowCount: number;
  storagePath: string | null;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

export interface SavedSearchDoc {
  _id: string;
  workspaceId: string;
  provider: string;
  country: string;
  city: string;
  categories: string[];
  limitCount: number;
  enabled: boolean;
  lastRunAt: Date | null;
  createdAt: Date;
}

/* ───────────────────────────── live events ──────────────────────── */

export interface LiveEventDoc {
  _id: string;
  workspaceId: string;
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  createdAt: Date;
}
