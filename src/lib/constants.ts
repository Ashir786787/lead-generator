import type { CategoryKey } from "@/lib/score/types";

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "Lead Finder";
export const APP_TAGLINE = "Discover businesses. Identify opportunities.";
export const WORKSPACE_COOKIE = "lf_workspace";
export const DEMO_WORKSPACE_SLUG = "demo-fictional";

export const PIPELINE_STATUSES = [
  "new",
  "reviewing",
  "qualified",
  "contacted",
  "follow_up",
  "proposal_sent",
  "won",
  "lost",
  "do_not_contact",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  new: "New",
  reviewing: "Reviewing",
  qualified: "Qualified",
  contacted: "Contacted",
  follow_up: "Follow-up",
  proposal_sent: "Proposal Sent",
  won: "Won",
  lost: "Lost",
  do_not_contact: "Do Not Contact",
};

export const SCAN_OUTCOME_LABELS: Record<string, string> = {
  success: "Checked",
  partial: "Incomplete",
  blocked_by_robots: "Blocked",
  unreachable: "Failed",
  timeout: "Failed",
  tls_error: "Failed",
  non_html: "Failed",
  rejected_url: "Rejected",
  cancelled: "Cancelled",
  error: "Failed",
};

export type ChatbotLabel = "detected" | "not_detected" | "unknown";

export const CHATBOT_LABELS: Record<ChatbotLabel, string> = {
  detected: "Detected",
  not_detected: "Not detected in checked pages",
  unknown: "Unknown",
};

export const CATEGORY_OPTIONS: Array<{ key: CategoryKey; label: string }> = [
  { key: "restaurant", label: "Restaurant" },
  { key: "cafe", label: "Café" },
  { key: "clinic", label: "Clinic" },
  { key: "dentist", label: "Dentist" },
  { key: "salon", label: "Salon" },
  { key: "spa", label: "Spa" },
  { key: "gym", label: "Gym / Fitness" },
  { key: "hotel", label: "Hotel" },
  { key: "real_estate", label: "Real estate" },
  { key: "law_firm", label: "Law firm" },
  { key: "accounting", label: "Accounting" },
  { key: "education", label: "Education" },
  { key: "ecommerce", label: "E-commerce" },
  { key: "retail", label: "Retail" },
  { key: "automotive", label: "Automotive" },
  { key: "construction", label: "Construction" },
  { key: "travel", label: "Travel" },
  { key: "other", label: "Other" },
];

export const SCAN_STATUS_PILLS: Record<string, { label: string; icon: string }> = {
  not_scanned: { label: "Not scanned", icon: "—" },
  queued: { label: "Queued", icon: "⏳" },
  scanning: { label: "Scanning", icon: "◔" },
  success: { label: "Checked", icon: "✓" },
  partial: { label: "Incomplete", icon: "⚠" },
  blocked_by_robots: { label: "Blocked", icon: "⛔" },
  unreachable: { label: "Failed", icon: "✕" },
  timeout: { label: "Failed", icon: "✕" },
  tls_error: { label: "Failed", icon: "✕" },
  non_html: { label: "Failed", icon: "✕" },
  rejected_url: { label: "Rejected", icon: "✕" },
  cancelled: { label: "Cancelled", icon: "—" },
  error: { label: "Failed", icon: "✕" },
};

export const OUTREACH_CHECKLIST = [
  "Introduce yourself clearly and say why you are getting in touch.",
  "Reference something specific about their business — relevance beats volume.",
  "Stop contacting immediately when asked.",
  "Send one message at a time; never run automated outreach.",
  "Check local advertising, privacy and consent rules before contacting anyone.",
];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
