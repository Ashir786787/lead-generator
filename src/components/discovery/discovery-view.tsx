"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Compass,
  Database,
  Globe2,
  History,
  Loader2,
  MapPin,
  Play,
  Search,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, errorMessage } from "@/lib/client/api";
import type { ImportSummary, SavedSearch } from "@/lib/client/types";
import { CATEGORY_OPTIONS } from "@/lib/constants";
import { formatNumber, relativeTime } from "@/lib/utils";
import { PageHeader, SectionCard } from "@/components/page";
import { Field } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

interface ProviderStatus {
  id: "osm" | "google_places";
  label: string;
  available: boolean;
  detail: string;
  attribution: string;
}

interface DiscoveryResult {
  provider: "osm" | "google_places";
  found: number;
  importJobId: string | null;
  counts: {
    validCount: number;
    newCount: number;
    mergedCount: number;
    reviewCount: number;
    duplicateCount: number;
    skippedCount: number;
    errorCount: number;
  } | null;
  sample: Array<{ name: string; city: string | null; website: string | null }>;
  message: string;
}

interface DiscoveryPayload {
  providers: ProviderStatus[];
  savedSearches: SavedSearch[];
  recent: ImportSummary[];
}

export function DiscoveryView({ initial }: { initial: DiscoveryPayload }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [provider, setProvider] = React.useState<"osm" | "google_places">("osm");
  const [country, setCountry] = React.useState("");
  const [city, setCity] = React.useState("");
  const [categories, setCategories] = React.useState<string[]>([]);
  const [limit, setLimit] = React.useState("50");
  const [saveSearch, setSaveSearch] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<DiscoveryResult | null>(null);

  const dataQuery = useQuery({
    queryKey: ["discovery"],
    queryFn: () => apiFetch<DiscoveryPayload>("/api/discovery"),
    initialData: initial,
  });

  const data = dataQuery.data;

  function toggleCategory(key: string) {
    setCategories((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : current.length >= 8
          ? current
          : [...current, key],
    );
  }

  function loadSaved(search: SavedSearch) {
    setProvider(search.provider === "google_places" ? "google_places" : "osm");
    setCountry(search.country);
    setCity(search.city);
    setCategories(search.categories);
    setLimit(String(search.limitCount));
    toast.info(`Loaded “${search.city}” into the form. Review it, then run the search.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function run() {
    if (provider === "google_places" && !data.providers.find((item) => item.id === "google_places")?.available) {
      toast.error("Google Places is not configured. Add GOOGLE_PLACES_API_KEY to enable it.");
      return;
    }
    if (!city.trim() || !country.trim()) {
      toast.error("Enter both a city and a country.");
      return;
    }
    if (!categories.length) {
      toast.error("Choose at least one category.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const response = await apiFetch<{ result: DiscoveryResult }>("/api/discovery", {
        method: "POST",
        body: JSON.stringify({
          provider,
          country: country.trim(),
          city: city.trim(),
          categories,
          limit: Number(limit) || 50,
          saveSearch,
        }),
      });
      setResult(response.result);
      toast.success(response.result.message);
      await queryClient.invalidateQueries({ queryKey: ["discovery"] });
      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      router.refresh();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  async function removeSaved(id: string) {
    try {
      await apiFetch(`/api/discovery/searches/${id}`, { method: "DELETE" });
      toast.success("Saved search removed.");
      await dataQuery.refetch();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Live sources"
        title="Discovery"
        description="Find real businesses from public sources and add them to this workspace. Every result keeps its attribution."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard
            title="Search a real source"
            description="Keep searches small and targeted. OpenStreetMap is a shared community service."
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {data.providers.map((item) => {
                  const active = provider === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setProvider(item.id)}
                      className={
                        active
                          ? "rounded-xl border-2 border-primary bg-primary/5 p-3 text-left"
                          : "rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40"
                      }
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <Database className="size-4 text-primary" /> {item.label}
                        </span>
                        <Badge variant={item.available ? "success" : "muted"}>
                          {item.available ? "Available" : "Unavailable"}
                        </Badge>
                      </span>
                      <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">{item.detail}</span>
                      <span className="mt-1.5 block text-[10px] text-muted-foreground">{item.attribution}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Country" htmlFor="discovery-country" required>
                  <Input
                    id="discovery-country"
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                    placeholder="e.g. Portugal"
                    maxLength={120}
                  />
                </Field>
                <Field label="City" htmlFor="discovery-city" required>
                  <Input
                    id="discovery-city"
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    placeholder="e.g. Lisbon"
                    maxLength={120}
                  />
                </Field>
              </div>

              <div>
                <Label className="mb-2 flex items-center gap-2">
                  Categories <span className="text-xs font-normal text-muted-foreground">Choose 1–8</span>
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_OPTIONS.map((option) => {
                    const active = categories.includes(option.key);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => toggleCategory(option.key)}
                        className={
                          active
                            ? "rounded-full border border-primary bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                            : "rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                        }
                        aria-pressed={active}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Maximum results" htmlFor="discovery-limit" hint="Smaller searches are kinder to shared services.">
                  <Select id="discovery-limit" value={limit} onChange={(event) => setLimit(event.target.value)}>
                    <option value="20">20 businesses</option>
                    <option value="50">50 businesses</option>
                    <option value="100">100 businesses</option>
                    <option value="200">200 businesses</option>
                  </Select>
                </Field>
                <div className="flex items-end">
                  <div className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium">Save this search</p>
                      <p className="text-xs text-muted-foreground">Reuse it later from the sidebar.</p>
                    </div>
                    <Switch checked={saveSearch} onCheckedChange={setSaveSearch} aria-label="Save this search" />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={() => void run()} disabled={running}>
                  {running ? <Loader2 className="animate-spin" /> : <Search />} Run discovery
                </Button>
                <p className="text-xs text-muted-foreground">
                  Results are imported through the same dedupe and validation pipeline as uploads.
                </p>
              </div>
            </div>
          </SectionCard>

          {result ? (
            <SectionCard
              title={result.found ? `Found ${formatNumber(result.found)} businesses` : "No results"}
              description={result.message}
              actions={
                result.importJobId ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/imports/${result.importJobId}`}>Open import</Link>
                  </Button>
                ) : null
              }
            >
              {result.sample.length ? (
                <>
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <ResultStat label="New" value={result.counts?.newCount ?? 0} />
                    <ResultStat label="Merged" value={result.counts?.mergedCount ?? 0} />
                    <ResultStat label="Review" value={result.counts?.reviewCount ?? 0} />
                    <ResultStat label="Skipped" value={result.counts?.skippedCount ?? 0} />
                  </div>
                  <ul className="divide-y divide-border/70">
                    {result.sample.map((item, index) => (
                      <li key={`${item.name}-${index}`} className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0">
                        <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.city ?? "—"}
                          {item.website ? " · website" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {result.found > result.sample.length ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Showing the first {result.sample.length} of {formatNumber(result.found)}. Open the import to see
                      everything that was saved.
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nothing was saved. Try a nearby city, a wider set of categories, or a different provider.
                </p>
              )}
            </SectionCard>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-card/50 px-5 py-8 text-center">
              <Wand2 className="mx-auto size-5 text-primary" />
              <p className="mt-2 text-sm font-medium">Live results, not sample data</p>
              <p className="mx-auto mt-1 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Discovery returns whatever the public source actually has for your query. If a source is unavailable,
                it stays unavailable instead of showing invented businesses.
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-5">
          <SectionCard title="Saved searches" description="Load one back into the form whenever you need it.">
            {data.savedSearches.length ? (
              <ul className="divide-y divide-border/70">
                {data.savedSearches.map((search) => (
                  <li key={search.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                          <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                          {search.city}, {search.country}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {search.provider === "osm" ? "OpenStreetMap" : "Google Places"} · {search.limitCount} max
                          {search.lastRunAt ? ` · ran ${relativeTime(search.lastRunAt)}` : " · never run"}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {search.categories.slice(0, 4).map((category) => (
                            <Badge key={category} variant="outline">
                              {CATEGORY_OPTIONS.find((option) => option.key === category)?.label ?? category}
                            </Badge>
                          ))}
                          {search.categories.length > 4 ? (
                            <Badge variant="outline">+{search.categories.length - 4}</Badge>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button type="button" size="iconSm" variant="outline" onClick={() => loadSaved(search)} aria-label="Use saved search">
                          <Play />
                        </Button>
                        <Button
                          type="button"
                          size="iconSm"
                          variant="ghost"
                          onClick={() => void removeSaved(search.id)}
                          aria-label="Delete saved search"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Saved searches let you repeat a good query without retyping it.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Recent discovery runs"
            description="Each run is recorded as an import."
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/imports">All imports</Link>
              </Button>
            }
          >
            {data.recent.length ? (
              <ul className="divide-y divide-border/70">
                {data.recent.map((item) => (
                  <li key={item.id} className="py-2.5 first:pt-0 last:pb-0">
                    <Link href={`/imports/${item.id}`} className="flex items-center gap-2 text-sm hover:underline">
                      <History className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{item.filename}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatNumber(item.newCount)} new</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Discovery runs will appear here.</p>
            )}
          </SectionCard>

          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Compass className="size-4 text-primary" /> Attribution and limits
            </h2>
            <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> OpenStreetMap data © OpenStreetMap
                contributors, available under the ODbL.
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> Searches are rate-limited to protect
                shared services.
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> Respect each source&apos;s terms and
                your local rules before contacting anyone.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ResultStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums">{formatNumber(value)}</p>
    </div>
  );
}
