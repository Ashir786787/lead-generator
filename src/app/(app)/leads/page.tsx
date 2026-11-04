import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { LeadsWorkspace } from "@/components/leads/leads-workspace";

export const dynamic = "force-dynamic";

export default function LeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="animate-spin" /> Loading leads…
        </div>
      }
    >
      <LeadsWorkspace />
    </Suspense>
  );
}
