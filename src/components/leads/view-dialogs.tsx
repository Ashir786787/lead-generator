"use client";

import * as React from "react";
import { Bookmark, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { SavedView } from "@/lib/client/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/form";

export function SaveViewDialog({
  open,
  onOpenChange,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: Record<string, string>;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    if (open) setName("");
  }, [open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    try {
      await apiFetch("/api/saved-views", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), query }),
      });
      toast.success("View saved.");
      await queryClient.invalidateQueries({ queryKey: ["saved-views"] });
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
          <DialogTitle>Save this view</DialogTitle>
          <DialogDescription>
            Saves the current filters for your account in this workspace. Only you will see it.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <Field label="View name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="High-score clinics in Leeds"
              maxLength={80}
              autoFocus
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? <Loader2 className="animate-spin" /> : <Bookmark />}
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ManageViewsDialog({
  open,
  onOpenChange,
  views,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  views: SavedView[];
  onApply: (view: SavedView) => void;
}) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = React.useState<string | null>(null);

  async function remove(view: SavedView) {
    setDeleting(view.id);
    try {
      await apiFetch(`/api/saved-views/${view.id}`, { method: "DELETE" });
      toast.success(`Removed “${view.name}”.`);
      await queryClient.invalidateQueries({ queryKey: ["saved-views"] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Saved views</DialogTitle>
          <DialogDescription>Apply a saved filter set or remove ones you no longer need.</DialogDescription>
        </DialogHeader>
        {views.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No saved views yet.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {views.map((view) => (
              <li key={view.id} className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => {
                    onApply(view);
                    onOpenChange(false);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-sm font-medium">{view.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {Object.keys(view.query).length} filter{Object.keys(view.query).length === 1 ? "" : "s"}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Delete ${view.name}`}
                  onClick={() => void remove(view)}
                  disabled={deleting === view.id}
                >
                  {deleting === view.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
