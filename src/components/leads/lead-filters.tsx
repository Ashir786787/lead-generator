"use client";

import * as React from "react";
import { Bookmark, ChevronDown, Filter, Search, SlidersHorizontal, X } from "lucide-react";
import type { LeadFacets, SavedView } from "@/lib/client/types";
import type { SortOption } from "@/lib/data/filters";
import { PIPELINE_STATUSES, PIPELINE_STATUS_LABELS, SCAN_OUTCOME_LABELS } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeFilterCount, type LeadFilterState, type TriState } from "@/components/leads/filter-state";

const SORT_LABELS: Record<SortOption, string> = {
  score_desc: "Score: high to low",
  score_asc: "Score: low to high",
  name_asc: "Name: A–Z",
  name_desc: "Name: Z–A",
  city_asc: "City: A–Z",
  last_checked_desc: "Last checked",
  created_desc: "Newest first",
};

export function LeadFilters({
  filters,
  facets,
  savedViews,
  onChange,
  onApplyView,
  onSaveView,
  onManageViews,
  total,
}: {
  filters: LeadFilterState;
  facets: LeadFacets | null;
  savedViews: SavedView[];
  onChange: (patch: Partial<LeadFilterState>) => void;
  onApplyView: (view: SavedView) => void;
  onSaveView: () => void;
  onManageViews: () => void;
  total: number;
}) {
  const [open, setOpen] = React.useState(false);
  const count = activeFilterCount(filters);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.q}
              onChange={(event) => onChange({ q: event.target.value, page: 1 })}
              placeholder="Search name, email, phone, city, website…"
              className="pl-9"
              aria-label="Search leads"
            />
            {filters.q ? (
              <button
                type="button"
                onClick={() => onChange({ q: "", page: 1 })}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Button
              type="button"
              variant={open || count > 0 ? "subtle" : "outline"}
              onClick={() => setOpen((value) => !value)}
            >
              <Filter />
              Filters
              {count > 0 ? (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  {count}
                </span>
              ) : null}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline">
                  <Bookmark />
                  Views
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel>Saved views</DropdownMenuLabel>
                <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                {savedViews.length === 0 ? (
                  <p className="px-2.5 py-2 text-xs text-muted-foreground">No saved views yet.</p>
                ) : (
                  savedViews.map((view) => (
                    <DropdownMenuItem key={view.id} onSelect={() => onApplyView(view)}>
                      <Bookmark className="opacity-60" />
                      <span className="truncate">{view.name}</span>
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator className="-mx-1 my-1 h-px bg-border" />
                <DropdownMenuItem onSelect={onSaveView}>
                  <SlidersHorizontal /> Save current view
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onManageViews} disabled={savedViews.length === 0}>
                  <X /> Manage views
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Select
              aria-label="Sort leads"
              value={filters.sort}
              onChange={(event) => onChange({ sort: event.target.value as SortOption, page: 1 })}
              className="col-span-2 sm:w-52"
            >
              {Object.entries(SORT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {open ? (
          <div className="grid gap-3 border-t border-border/70 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterField label="City">
              <Select value={filters.city} onChange={(event) => onChange({ city: event.target.value, page: 1 })}>
                <option value="">All cities</option>
                {facets?.cities.map((city) => (
                  <option key={city.value} value={city.value}>
                    {city.value} ({city.count})
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Stage">
              <Select value={filters.status} onChange={(event) => onChange({ status: event.target.value, page: 1 })}>
                <option value="">All stages</option>
                {PIPELINE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {PIPELINE_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Category">
              <Select
                value={filters.category}
                onChange={(event) => onChange({ category: event.target.value, page: 1 })}
              >
                <option value="">All categories</option>
                {facets?.categories.map((category) => (
                  <option key={category.value} value={category.value}>
                    {category.label} ({category.count})
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Minimum score">
              <Select
                value={filters.minScore}
                onChange={(event) => onChange({ minScore: event.target.value, page: 1 })}
              >
                <option value="">Any score</option>
                <option value="80">80+</option>
                <option value="70">70+</option>
                <option value="60">60+</option>
                <option value="50">50+</option>
                <option value="40">40+</option>
                <option value="20">20+</option>
              </Select>
            </FilterField>
            <FilterField label="Website">
              <Select
                value={filters.hasWebsite}
                onChange={(event) => onChange({ hasWebsite: event.target.value as TriState, page: 1 })}
              >
                <option value="">Any</option>
                <option value="true">Has a website</option>
                <option value="false">No website</option>
              </Select>
            </FilterField>
            <FilterField label="Email">
              <Select
                value={filters.hasEmail}
                onChange={(event) => onChange({ hasEmail: event.target.value as TriState, page: 1 })}
              >
                <option value="">Any</option>
                <option value="true">Has an email</option>
                <option value="false">No email found</option>
              </Select>
            </FilterField>
            <FilterField label="WhatsApp link">
              <Select
                value={filters.hasWhatsapp}
                onChange={(event) => onChange({ hasWhatsapp: event.target.value as TriState, page: 1 })}
              >
                <option value="">Any</option>
                <option value="true">Has a WhatsApp link</option>
                <option value="false">No WhatsApp link</option>
              </Select>
            </FilterField>
            <FilterField label="Follow-up">
              <Select
                value={filters.followUp}
                onChange={(event) => onChange({ followUp: event.target.value, page: 1 })}
              >
                <option value="">Any</option>
                <option value="overdue">Overdue</option>
                <option value="today">Due today</option>
                <option value="any">Has a follow-up date</option>
              </Select>
            </FilterField>
            <FilterField label="Bot detection">
              <Select
                value={filters.chatbot}
                onChange={(event) => onChange({ chatbot: event.target.value, page: 1 })}
              >
                <option value="">Any result</option>
                <option value="detected">Detected</option>
                <option value="not_detected">Not detected in checked pages</option>
                <option value="unknown">Unknown</option>
              </Select>
            </FilterField>
            <FilterField label="Scan outcome">
              <Select
                value={filters.scanOutcome}
                onChange={(event) => onChange({ scanOutcome: event.target.value, page: 1 })}
              >
                <option value="">Any outcome</option>
                {Object.entries(SCAN_OUTCOME_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {value === "partial" ? "Scan incomplete" : label}
                  </option>
                ))}
              </Select>
            </FilterField>
            <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-center lg:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-[var(--primary)]"
                  checked={filters.includeArchived}
                  onChange={(event) => onChange({ includeArchived: event.target.checked, page: 1 })}
                />
                Include archived
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-input accent-[var(--primary)]"
                  checked={filters.includeDnc}
                  onChange={(event) => onChange({ includeDnc: event.target.checked, page: 1 })}
                />
                Include do-not-contact
              </label>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {total === 0 ? "No matching leads" : `${total.toLocaleString("en-US")} matching lead${total === 1 ? "" : "s"}`}
          </span>
          {count > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onChange({
                    q: "",
                    city: "",
                    status: "",
                    category: "",
                    minScore: "",
                    hasWebsite: "",
                    hasEmail: "",
                    hasWhatsapp: "",
                    scanOutcome: "",
                    chatbot: "",
                    followUp: "",
                    includeArchived: false,
                    includeDnc: false,
                    page: 1,
                  })
                }
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-medium text-foreground hover:bg-secondary"
              >
                <X className="size-3" /> Clear filters
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
