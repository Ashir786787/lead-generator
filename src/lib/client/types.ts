export type { LeadRow, LeadListResult, LeadDetail } from "@/lib/data/leads";
export type { LeadFacets } from "@/lib/data/facets";
export type { SavedView } from "@/lib/data/saved-views";
export type { ImportSummary, ImportDetail } from "@/lib/import/service";
export type { DuplicatePair } from "@/lib/dedupe/service";
export type { ScanJobSummary } from "@/lib/scan/service";
export type { SavedSearch } from "@/lib/discovery/service";
export type { WorkspaceSettings } from "@/lib/data/workspace";
export type { ScoreConfig } from "@/lib/score/types";
export type { ColumnMapping, ImportField } from "@/lib/import/mapping";

export interface WorkspaceOverview {
  total: number;
  fresh: number;
  reviewed: number;
  qualified: number;
  contacted: number;
  won: number;
  avgScore: number | null;
  withWebsite: number;
  checkedSuccess: number;
  chatbotDetected: number;
  chatbotNotDetected: number;
  chatbotUnknown: number;
  pendingDuplicates: number;
}

export interface ScanSummary {
  queued: number;
  running: number;
  needsReview: number;
  neverChecked: number;
  workerOnline: boolean;
}
