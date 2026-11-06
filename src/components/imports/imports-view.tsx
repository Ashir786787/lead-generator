"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { ColumnMapping, ImportField, ImportSummary } from "@/lib/client/types";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/utils";
import { EmptyState, PageHeader } from "@/components/page";
import { Field, InlineAlert } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

interface FilePreview {
  kind: "csv" | "geojson" | "zip";
  columns: string[];
  rows: Record<string, unknown>[];
  files?: string[];
  notes: string[];
}

interface ImportPreviewResult {
  importJobId: string;
  filename: string;
  fileHash: string;
  preview: FilePreview;
  mapping: ColumnMapping;
  warnings: string[];
  rowHint: number | null;
  duplicateOf: { id: string; filename: string; createdAt: string } | null;
}

const FIELD_LABELS: Array<{ field: ImportField; label: string; required?: boolean; hint?: string }> = [
  { field: "name", label: "Business name", required: true },
  { field: "category", label: "Category" },
  { field: "website", label: "Website" },
  { field: "phone", label: "Phone" },
  { field: "email", label: "Email" },
  { field: "street", label: "Street address" },
  { field: "area", label: "Area / district" },
  { field: "city", label: "City" },
  { field: "country", label: "Country" },
  { field: "lat", label: "Latitude" },
  { field: "lng", label: "Longitude" },
  { field: "sourceId", label: "Source ID", hint: "Keeps provenance and prevents accidental duplicates." },
];

export function ImportStatusBadge({ status }: { status: string }) {
  const variant =
    status === "completed"
      ? "success"
      : status === "processing" || status === "queued"
        ? "info"
        : status === "partial"
          ? "warning"
          : status === "cancelled"
            ? "muted"
            : "danger";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

export function ImportsView({ initial, timezone }: { initial: ImportSummary[]; timezone: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const importsQuery = useQuery({
    queryKey: ["imports"],
    queryFn: () => apiFetch<{ items: ImportSummary[] }>("/api/imports"),
    initialData: { items: initial },
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((item) => item.status === "queued" || item.status === "processing") ? 3000 : false;
    },
  });

  const imports = importsQuery.data.items;

  function onStarted(importJobId: string) {
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["imports"] });
    router.push(`/imports/${importJobId}`);
    router.refresh();
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Bring in data"
        title="Imports"
        description="Upload a list you have the right to use. Every row keeps its source, and malformed rows are explained instead of silently dropped."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/discovery">
                <Compass /> Discover live data
              </Link>
            </Button>
            <Button type="button" onClick={() => setOpen(true)}>
              <Upload /> Upload a file
            </Button>
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Total imports" value={formatNumber(imports.length)} />
        <MiniStat
          label="Running now"
          value={formatNumber(imports.filter((item) => item.status === "queued" || item.status === "processing").length)}
        />
        <MiniStat
          label="Leads added"
          value={formatNumber(imports.reduce((sum, item) => sum + item.newCount, 0))}
        />
      </div>

      {imports.length === 0 ? (
        <EmptyState
          icon={<FileUp className="size-5" />}
          title="No files imported yet"
          description="CSV, TSV, GeoJSON and ZIP archives are supported. The first ten rows are previewed before anything is committed."
          actions={
            <>
              <Button type="button" onClick={() => setOpen(true)}>
                <Upload /> Upload your first list
              </Button>
              <Button asChild variant="outline">
                <Link href="/discovery">Discover from OpenStreetMap</Link>
              </Button>
            </>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="hidden grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,0.7fr))_minmax(0,0.9fr)] gap-3 border-b border-border/70 bg-muted/35 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <span>File</span>
            <span>Status</span>
            <span className="text-right">Rows</span>
            <span className="text-right">New</span>
            <span className="text-right">Review</span>
            <span className="text-right">Created</span>
          </div>
          <ul className="divide-y divide-border/70">
            {imports.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/imports/${item.id}`}
                  className="grid gap-3 px-4 py-3 transition-colors hover:bg-muted/55 md:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,0.7fr))_minmax(0,0.9fr)] md:items-center"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      {item.origin === "discovery" ? <Compass className="size-4" /> : <FileSpreadsheet className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.filename}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.origin === "discovery" ? "Discovery run" : "File upload"}
                        {item.duplicateFile ? " · same file seen before" : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <ImportStatusBadge status={item.status} />
                    {item.status === "processing" ? <span className="text-xs text-muted-foreground">{item.progress}%</span> : null}
                  </div>
                  <div className="text-xs md:text-right md:text-sm">
                    <span className="text-muted-foreground md:hidden">Rows: </span>
                    <span className="tabular-nums">{formatNumber(item.rowCount)}</span>
                  </div>
                  <div className="text-xs md:text-right md:text-sm">
                    <span className="text-muted-foreground md:hidden">New: </span>
                    <span className="tabular-nums text-success">{formatNumber(item.newCount)}</span>
                  </div>
                  <div className="text-xs md:text-right md:text-sm">
                    <span className="text-muted-foreground md:hidden">Review: </span>
                    <span className="tabular-nums text-warning">{formatNumber(item.reviewCount)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground md:justify-end">
                    {item.errorCount ? (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertTriangle className="size-3" /> {item.errorCount}
                      </span>
                    ) : null}
                    <span title={formatDateTime(item.createdAt, timezone)}>{relativeTime(item.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <UploadDialog open={open} onOpenChange={setOpen} onStarted={onStarted} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function UploadDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (importJobId: string) => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
  const [preview, setPreview] = React.useState<ImportPreviewResult | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [existingJobId, setExistingJobId] = React.useState<string | null>(null);
  const [force, setForce] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setMapping({});
    setExistingJobId(null);
    setForce(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function upload() {
    if (!file) return;
    setUploading(true);
    setExistingJobId(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await apiFetch<ImportPreviewResult>("/api/imports", { method: "POST", body: form });
      setPreview(result);
      setMapping(result.mapping);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function start(forceValue = force) {
    if (!preview) return;
    if (!mapping.name) {
      toast.error("Map a column to “Business name” before starting.");
      return;
    }
    setStarting(true);
    try {
      const result = await apiFetch<{
        importJobId: string;
        queued: boolean;
        completed?: boolean;
        status?: string;
        existingJobId?: string;
      }>(
        `/api/imports/${preview.importJobId}/start`,
        { method: "POST", body: JSON.stringify({ mapping, force: forceValue }) },
      );
      if (!result.queued && result.existingJobId) {
        setExistingJobId(result.existingJobId);
        setForce(true);
        toast.info("This exact file and mapping was imported before.");
        return;
      }
      if (result.status === "failed") {
        toast.error("Import failed. Open the import to see the row errors.");
      } else if (result.completed) {
        toast.success("Import completed.");
      } else {
        toast.success("Import queued. Progress will appear on the next screen.");
      }
      reset();
      onStarted(result.importJobId);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setStarting(false);
    }
  }

  const columns = preview?.preview.columns ?? [];
  const sampleRows = preview?.preview.rows.slice(0, 5) ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{preview ? "Map your columns" : "Upload a file"}</DialogTitle>
          <DialogDescription>
            {preview
              ? "Match the fields you want to keep. You can start without every field — a business name is required."
              : "CSV, TSV, GeoJSON, JSON or ZIP (containing supported files). Upload data you have the right to use."}
          </DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <label
              htmlFor="import-file"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <FileUp className="size-7 text-primary" />
              <span className="text-sm font-medium">{file ? file.name : "Choose a file to upload"}</span>
              <span className="text-xs text-muted-foreground">
                {file ? `${(file.size / 1024).toFixed(1)} KB · ready to inspect` : "Nothing is committed until you confirm the mapping."}
              </span>
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept=".csv,.tsv,.geojson,.json,.zip"
                className="sr-only"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null;
                  setFile(next);
                  setPreview(null);
                }}
              />
            </label>
            <InlineAlert tone="info" title="A note on consent">
              Only import business data you can lawfully use. This app never sends outreach, and you remain responsible
              for local privacy and advertising rules.
            </InlineAlert>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <FileSpreadsheet className="size-4 text-primary" />
              <span className="font-medium text-foreground">{preview.filename}</span>
              <Badge variant="outline" className="uppercase">{preview.preview.kind}</Badge>
              <span>{columns.length} columns</span>
              <span>·</span>
              <span>{preview.rowHint === null ? "row count unknown" : `about ${formatNumber(preview.rowHint)} rows`}</span>
            </div>

            {preview.duplicateOf ? (
              <InlineAlert tone="warning" title="This file was imported before">
                “{preview.duplicateOf.filename}” has the same contents. Starting again may create duplicate records.{" "}
                <Link href={`/imports/${preview.duplicateOf.id}`} className="font-medium underline underline-offset-2">
                  Open the previous import
                </Link>
                .
              </InlineAlert>
            ) : null}

            {preview.warnings.length ? (
              <div className="space-y-1 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                {preview.warnings.map((warning) => (
                  <p key={warning} className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {warning}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              {FIELD_LABELS.map(({ field, label, required, hint }) => (
                <Field key={field} label={label} required={required} hint={hint} htmlFor={`map-${field}`}>
                  <Select
                    id={`map-${field}`}
                    value={mapping[field] ?? ""}
                    onChange={(event) =>
                      setMapping((current) => {
                        const next = { ...current };
                        if (event.target.value) next[field] = event.target.value;
                        else delete next[field];
                        return next;
                      })
                    }
                  >
                    <option value="">— Not mapped —</option>
                    {columns.map((column) => (
                      <option key={column} value={column}>
                        {column}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {sampleRows.length ? (
              <div className="rounded-lg border border-border">
                <p className="border-b border-border/70 px-3 py-2 text-xs font-semibold text-muted-foreground">
                  First {sampleRows.length} rows
                </p>
                <div className="max-h-52 overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        {columns.slice(0, 8).map((column) => (
                          <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sampleRows.map((row, index) => (
                        <tr key={index}>
                          {columns.slice(0, 8).map((column) => (
                            <td key={column} className="max-w-44 truncate px-3 py-1.5">
                              {row[column] === null || row[column] === undefined ? "—" : String(row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {preview.preview.notes.length ? (
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {preview.preview.notes.map((note) => (
                  <li key={note} className="flex items-start gap-1.5">
                    <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> {note}
                  </li>
                ))}
              </ul>
            ) : null}

            {existingJobId ? (
              <InlineAlert
                tone="warning"
                title="Already imported"
                action={
                  <Button type="button" size="sm" variant="outline" onClick={() => void start(true)} disabled={starting}>
                    Import anyway
                  </Button>
                }
              >
                The same file with the same mapping was already imported.{" "}
                <Link href={`/imports/${existingJobId}`} className="font-medium underline underline-offset-2">
                  View that import
                </Link>
                .
              </InlineAlert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {preview ? (
            <>
              <Button type="button" variant="ghost" onClick={reset} disabled={starting}>
                <X /> Choose another file
              </Button>
              <Button type="button" onClick={() => void start()} disabled={starting || !mapping.name}>
                {starting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Start import
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void upload()} disabled={!file || uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Inspect file
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
