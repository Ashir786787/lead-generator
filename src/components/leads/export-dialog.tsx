"use client";

import * as React from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { downloadExport, errorMessage, saveBlob } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ExportDialog({
  open,
  onOpenChange,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: Record<string, string>;
}) {
  const [includeNotes, setIncludeNotes] = React.useState(false);
  const [includeDnc, setIncludeDnc] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function runExport() {
    setPending(true);
    try {
      const result = await downloadExport({ query, includeNotes, includeDnc });
      saveBlob(result.blob, result.filename);
      toast.success(`Exported ${result.rowCount.toLocaleString("en-US")} leads.`);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export leads as CSV</DialogTitle>
          <DialogDescription>
            The same filters as the current table are applied. Exports are recorded in the workspace history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3.5">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={includeNotes}
              onChange={(event) => setIncludeNotes(event.target.checked)}
              className="mt-0.5 size-4 rounded border-input accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">Include notes</span>
              <span className="block text-xs text-muted-foreground">
                Internal notes are only for your workspace. Handle the file carefully.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={includeDnc}
              onChange={(event) => setIncludeDnc(event.target.checked)}
              className="mt-0.5 size-4 rounded border-input accent-[var(--primary)]"
            />
            <span>
              <span className="block font-medium">Include do-not-contact leads</span>
              <span className="block text-xs text-muted-foreground">
                Usually excluded to prevent accidental outreach.
              </span>
            </span>
          </label>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          This app never sends email, SMS or WhatsApp messages. You are responsible for checking that you have a
          lawful basis and that your message follows local rules.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void runExport()} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Download />}
            {pending ? "Preparing…" : "Download CSV"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
