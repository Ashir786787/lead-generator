import { randomUUID } from "node:crypto";
import {
  MongoClient,
  type ClientSession,
  type Collection,
  type Db,
} from "mongodb";
import { env } from "@/lib/env";
import type {
  AccountDoc,
  ActivityDoc,
  BusinessDoc,
  BusinessLocationDoc,
  BusinessTagDoc,
  CategoryMappingDoc,
  ContactPointDoc,
  DuplicateCandidateDoc,
  EvidenceRecordDoc,
  ExportJobDoc,
  ImportJobDoc,
  ImportRowErrorDoc,
  LiveEventDoc,
  MembershipDoc,
  MergeHistoryDoc,
  NoteDoc,
  SavedSearchDoc,
  SavedViewDoc,
  ScanJobDoc,
  ScanResultDoc,
  ScoreProfileDoc,
  ScoreResultDoc,
  SessionDoc,
  SourceRecordDoc,
  TagDoc,
  UserDoc,
  VerificationDoc,
  WorkspaceDoc,
} from "./types";

const globalForMongo = globalThis as unknown as {
  __leadFinderMongoClient?: MongoClient;
};

/**
 * Serverless functions freeze and thaw, so the client is cached on `globalThis`
 * to reuse sockets between invocations instead of reconnecting on every render.
 */
export const mongoClient =
  globalForMongo.__leadFinderMongoClient ??
  new MongoClient(env.mongoUri, {
    maxPoolSize: env.isTest ? 5 : 20,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    retryWrites: true,
  });

if (!env.isProduction) {
  globalForMongo.__leadFinderMongoClient = mongoClient;
}

export const mongoDb: Db = mongoClient.db(env.mongoDbName);

function collection<T extends { _id: string }>(name: string): Collection<T> {
  return mongoDb.collection<T>(name);
}

export const collections = {
  user: collection<UserDoc>("user"),
  session: collection<SessionDoc>("session"),
  account: collection<AccountDoc>("account"),
  verification: collection<VerificationDoc>("verification"),
  workspaces: collection<WorkspaceDoc>("workspaces"),
  memberships: collection<MembershipDoc>("memberships"),
  businesses: collection<BusinessDoc>("businesses"),
  businessLocations: collection<BusinessLocationDoc>("business_locations"),
  sourceRecords: collection<SourceRecordDoc>("source_records"),
  contactPoints: collection<ContactPointDoc>("contact_points"),
  importJobs: collection<ImportJobDoc>("import_jobs"),
  importRowErrors: collection<ImportRowErrorDoc>("import_row_errors"),
  scanJobs: collection<ScanJobDoc>("scan_jobs"),
  scanResults: collection<ScanResultDoc>("scan_results"),
  evidenceRecords: collection<EvidenceRecordDoc>("evidence_records"),
  scoreProfiles: collection<ScoreProfileDoc>("score_profiles"),
  scoreResults: collection<ScoreResultDoc>("score_results"),
  notes: collection<NoteDoc>("notes"),
  tags: collection<TagDoc>("tags"),
  businessTags: collection<BusinessTagDoc>("business_tags"),
  activities: collection<ActivityDoc>("activities"),
  duplicateCandidates: collection<DuplicateCandidateDoc>("duplicate_candidates"),
  mergeHistory: collection<MergeHistoryDoc>("merge_history"),
  savedViews: collection<SavedViewDoc>("saved_views"),
  categoryMappings: collection<CategoryMappingDoc>("category_mappings"),
  exportJobs: collection<ExportJobDoc>("export_jobs"),
  savedSearches: collection<SavedSearchDoc>("saved_searches"),
  liveEvents: collection<LiveEventDoc>("live_events"),
} as const;

export function newId(): string {
  return randomUUID();
}

export function now(): Date {
  return new Date();
}

export async function connectMongo(): Promise<Db> {
  await mongoClient.connect();
  return mongoDb;
}

export async function closeMongo(): Promise<void> {
  await mongoClient.close();
}

/**
 * Run a unit of work in a MongoDB transaction. Atlas free clusters are replica
 * sets, so this is available; the callback may be retried on transient errors,
 * which is why every write inside merge/undo is an upsert or a set update.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = mongoClient.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } finally {
    await session.endSession();
  }
}

export type { Db };
export * from "./types";
