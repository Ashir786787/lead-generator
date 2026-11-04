import { Badge } from "@/components/ui/badge";
import { CHATBOT_LABELS, PIPELINE_STATUS_LABELS, SCAN_OUTCOME_LABELS, type PipelineStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<PipelineStatus, string> = {
  new: "bg-info-soft text-info",
  reviewing: "bg-warning-soft text-warning",
  qualified: "bg-primary/12 text-primary",
  contacted: "bg-primary/12 text-primary",
  follow_up: "bg-warning-soft text-warning",
  proposal_sent: "bg-primary/12 text-primary",
  won: "bg-success-soft text-success",
  lost: "bg-muted text-muted-foreground",
  do_not_contact: "bg-danger-soft text-destructive",
};

export function StatusBadge({ status, className }: { status: PipelineStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium leading-5",
        STATUS_STYLES[status],
        className,
      )}
    >
      {PIPELINE_STATUS_LABELS[status]}
    </span>
  );
}

export function ScoreBadge({ score, className }: { score: number | null; className?: string }) {
  if (score === null || score === undefined) {
    return (
      <span className={cn("text-xs tabular-nums text-muted-foreground", className)} title="Not scored yet">
        —
      </span>
    );
  }
  const tone = score >= 70 ? "success" : score >= 40 ? "warning" : "muted";
  return (
    <Badge variant={tone} className={cn("min-w-10 justify-center font-semibold tabular-nums", className)}>
      {score}
    </Badge>
  );
}

export function ChatbotBadge({
  result,
  className,
}: {
  result: string | null;
  className?: string;
}) {
  if (!result) {
    return (
      <Badge variant="outline" className={className}>
        Not scanned
      </Badge>
    );
  }
  const label = CHATBOT_LABELS[result as keyof typeof CHATBOT_LABELS] ?? "Unknown";
  const variant = result === "detected" ? "warning" : result === "not_detected" ? "success" : "outline";
  return (
    <Badge variant={variant} className={cn("max-w-full truncate", className)} title={label}>
      {label}
    </Badge>
  );
}

export function ScanOutcomeBadge({
  outcome,
  className,
}: {
  outcome: string | null;
  className?: string;
}) {
  if (!outcome) {
    return (
      <Badge variant="outline" className={className}>
        Not scanned
      </Badge>
    );
  }
  const variant =
    outcome === "success"
      ? "success"
      : outcome === "partial" || outcome === "blocked_by_robots"
        ? "warning"
        : outcome === "cancelled"
          ? "muted"
          : "danger";
  const label =
    outcome === "partial"
      ? "Scan incomplete"
      : outcome === "blocked_by_robots"
        ? "Blocked by robots.txt"
        : (SCAN_OUTCOME_LABELS[outcome] ?? outcome);
  return (
    <Badge variant={variant} className={cn("max-w-full truncate", className)} title={label}>
      {label}
    </Badge>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const labels: Record<string, string> = {
    import: "Import",
    discovery: "Discovery",
    osm: "OpenStreetMap",
    google_places: "Google Places",
    demo: "Demo (fictional)",
    manual: "Added manually",
  };
  return <Badge variant={source === "demo" ? "warning" : "outline"}>{labels[source] ?? source}</Badge>;
}
