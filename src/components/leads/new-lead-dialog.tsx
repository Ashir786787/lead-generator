"use client";

import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/form";
import { CATEGORY_OPTIONS, PIPELINE_STATUSES, PIPELINE_STATUS_LABELS } from "@/lib/constants";

interface FormState {
  name: string;
  category: string;
  website: string;
  phone: string;
  email: string;
  street: string;
  area: string;
  city: string;
  country: string;
  status: string;
  notes: string;
  followUpAt: string;
  tags: string;
}

const EMPTY: FormState = {
  name: "",
  category: "",
  website: "",
  phone: "",
  email: "",
  street: "",
  area: "",
  city: "",
  country: "",
  status: "new",
  notes: "",
  followUpAt: "",
  tags: "",
};

export function NewLeadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (leadId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [emailError, setEmailError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm(EMPTY);
      setError(null);
      setEmailError(null);
    }
  }, [open]);

  function update(patch: Partial<FormState>) {
    setForm((value) => ({ ...value, ...patch }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setEmailError(null);
    if (!form.name.trim()) {
      setError("Enter the business name.");
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setEmailError("Enter a valid email address, or leave it blank.");
      return;
    }
    setPending(true);
    try {
      const result = await apiFetch<{ id: string }>("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category.trim() || null,
          website: form.website.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
          street: form.street.trim() || null,
          area: form.area.trim() || null,
          city: form.city.trim() || null,
          country: form.country.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
          followUpAt: form.followUpAt ? new Date(form.followUpAt).toISOString() : null,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      toast.success("Lead added.");
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["lead-facets"] });
      onOpenChange(false);
      onCreated?.(result.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a lead manually</DialogTitle>
          <DialogDescription>
            Use this for a business you found yourself. Nothing is guessed — blank fields stay blank.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error ? (
            <div className="rounded-lg border border-destructive/25 bg-danger-soft px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" required className="sm:col-span-2">
              <Input
                value={form.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="e.g. Riverside Dental"
                autoFocus
              />
            </Field>
            <Field label="Category" hint="Free text, or pick a suggestion.">
              <Input
                list="new-lead-categories"
                value={form.category}
                onChange={(event) => update({ category: event.target.value })}
                placeholder="Dentist"
              />
              <datalist id="new-lead-categories">
                {CATEGORY_OPTIONS.map((category) => (
                  <option key={category.key} value={category.label} />
                ))}
              </datalist>
            </Field>
            <Field label="Stage">
              <Select value={form.status} onChange={(event) => update({ status: event.target.value })}>
                {PIPELINE_STATUSES.filter((status) => status !== "do_not_contact").map((status) => (
                  <option key={status} value={status}>
                    {PIPELINE_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Website" hint="Include https:// if you know it.">
              <Input
                value={form.website}
                onChange={(event) => update({ website: event.target.value })}
                placeholder="https://example.com"
                inputMode="url"
              />
            </Field>
            <Field label="Phone" hint="Local or international format.">
              <Input
                value={form.phone}
                onChange={(event) => update({ phone: event.target.value })}
                placeholder="+44 20 7946 0000"
                inputMode="tel"
              />
            </Field>
            <Field label="Email" error={emailError ?? undefined} className="sm:col-span-2">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => update({ email: event.target.value })}
                placeholder="hello@example.com"
              />
            </Field>
            <Field label="City">
              <Input value={form.city} onChange={(event) => update({ city: event.target.value })} />
            </Field>
            <Field label="Country">
              <Input value={form.country} onChange={(event) => update({ country: event.target.value })} />
            </Field>
            <Field label="Street">
              <Input value={form.street} onChange={(event) => update({ street: event.target.value })} />
            </Field>
            <Field label="Area / district">
              <Input value={form.area} onChange={(event) => update({ area: event.target.value })} />
            </Field>
            <Field label="Follow-up date">
              <Input
                type="date"
                value={form.followUpAt}
                onChange={(event) => update({ followUpAt: event.target.value })}
              />
            </Field>
            <Field label="Tags" hint="Comma-separated, up to 20.">
              <Input
                value={form.tags}
                onChange={(event) => update({ tags: event.target.value })}
                placeholder="high priority, referral"
              />
            </Field>
            <Field label="Notes" className="sm:col-span-2">
              <Textarea
                value={form.notes}
                onChange={(event) => update({ notes: event.target.value })}
                rows={3}
                placeholder="Anything useful for the next conversation."
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" /> : <Plus />}
              {pending ? "Adding…" : "Add lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
