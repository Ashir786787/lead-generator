"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  Database,
  Globe2,
  History,
  Loader2,
  MapPin,
  Play,
  Search,
  Sparkles,
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
import { Textarea } from "@/components/ui/textarea";
import {
  DiscoveryMap,
  type DiscoveryMapBounds,
  type DiscoveryMapMarker,
} from "@/components/discovery/discovery-map";

type ProviderId = "osm" | "google_places";
type PlannerChoice = "auto" | "gemini" | "grok" | "groq";

interface ProviderStatus {
  id: ProviderId;
  label: string;
  available: boolean;
  detail: string;
  attribution: string;
}

interface PlannerStatus {
  id: "gemini" | "grok" | "groq";
  label: string;
  available: boolean;
  model: string;
  detail: string;
}

interface DiscoveryResult {
  provider: ProviderId;
  via: "overpass" | "nominatim" | null;
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
  sample: Array<{
    name: string;
    city: string | null;
    website: string | null;
    lat: number | null;
    lng: number | null;
  }>;
  mapped: DiscoveryMapMarker[];
  message: string;
}

interface DiscoveryPlan {
  planner: "gemini" | "grok" | "groq";
  model: string;
  provider: ProviderId;
  country: string;
  city: string;
  categories: string[];
  limit: number;
  reasoning: string;
  notes: string[];
}

interface DiscoveryPayload {
  providers: ProviderStatus[];
  planners: PlannerStatus[];
  savedSearches: SavedSearch[];
  recent: ImportSummary[];
}

interface GeocodeHit {
  displayName: string;
  city: string | null;
  country: string | null;
  lat: number;
  lng: number;
  bounds: DiscoveryMapBounds | null;
}

interface RunOverrides {
  provider: ProviderId;
  country: string;
  city: string;
  categories: string[];
  limit: number;
}

interface ChatEntry {
  id: string;
  prompt: string;
  plan: DiscoveryPlan | null;
  error: string | null;
}

const CHAT_EXAMPLES = [
  "Dentists in Lisbon, Portugal",
  "Cafes in Berlin",
  "Gyms in Karachi, Pakistan",
];

export function DiscoveryView({ initial }: { initial: DiscoveryPayload }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [provider, setProvider] = React.useState<ProviderId>("osm");
  const [country, setCountry] = React.useState("");
  const [city, setCity] = React.useState("");
  const [categories, setCategories] = React.useState<string[]>([]);
  const [limit, setLimit] = React.useState("50");
  const [saveSearch, setSaveSearch] = React.useState(true);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<DiscoveryResult | null>(null);

  const [prompt, setPrompt] = React.useState("");
  const [planner, setPlanner] = React.useState<PlannerChoice>("auto");
  const [planning, setPlanning] = React.useState(false);
  const [chat, setChat] = React.useState<ChatEntry[]>([]);

  const [mapCenter, setMapCenter] = React.useState<{ lat: number; lng: number } | null>(null);
  const [mapBounds, setMapBounds] = React.useState<DiscoveryMapBounds | null>(null);
  const [mapMarkers, setMapMarkers] = React.useState<DiscoveryMapMarker[]>([]);
  const [mapLabel, setMapLabel] = React.useState("");
  const [locating, setLocating] = React.useState(false);

  const dataQuery = useQuery({
    queryKey: ["discovery"],
    queryFn: () => apiFetch<DiscoveryPayload>("/api/discovery"),
    initialData: initial,
  });

  const data = dataQuery.data;
  const planners = data.planners ?? [];
  const anyPlannerAvailable = planners.some((item) => item.available);

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

  async function previewArea(
    areaCity = city,
    areaCountry = country,
    options: { silent?: boolean } = {},
  ) {
    if (!areaCity.trim()) {
      toast.error("Enter a city first.");
      return;
    }
    setLocating(true);
    try {
      const query = areaCountry.trim()
        ? `${areaCity.trim()}, ${areaCountry.trim()}`
        : areaCity.trim();
      const response = await apiFetch<{ results: GeocodeHit[]; attribution: string }>(
        `/api/discovery/geocode?q=${encodeURIComponent(query)}`,
      );
      const best = response.results[0];
      if (!best) {
        if (!options.silent) {
          toast.info("That place could not be found on OpenStreetMap. Check the spelling.");
        }
        return;
      }
      setMapMarkers([]);
      setMapBounds(best.bounds);
      setMapCenter({ lat: best.lat, lng: best.lng });
      setMapLabel(`${best.city ?? areaCity}, ${best.country ?? areaCountry}`.replace(/,\s*$/, ""));
      if (!options.silent) toast.success(`Map centred on ${best.displayName}.`);
    } catch (error) {
      if (!options.silent) toast.error(errorMessage(error));
    } finally {
      setLocating(false);
    }
  }

  async function planSearch() {
    const text = prompt.trim();
    if (text.length < 3) {
      toast.error("Describe the businesses and location you want.");
      return;
    }
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setChat((current) => [...current, { id: entryId, prompt: text, plan: null, error: null }]);
    setPrompt("");
    setPlanning(true);
    try {
      const response = await apiFetch<{ plan: DiscoveryPlan; planners: PlannerStatus[] }>(
        "/api/discovery/plan",
        {
          method: "POST",
          body: JSON.stringify({ prompt: text, planner }),
        },
      );
      setChat((current) =>
        current.map((entry) => (entry.id === entryId ? { ...entry, plan: response.plan } : entry)),
      );
      toast.success(
        `Plan ready: ${response.plan.categories.length} categor${response.plan.categories.length === 1 ? "y" : "ies"} in ${response.plan.city}.`,
      );
    } catch (error) {
      const message = errorMessage(error);
      setChat((current) =>
        current.map((entry) => (entry.id === entryId ? { ...entry, error: message } : entry)),
      );
      toast.error(message);
    } finally {
      setPlanning(false);
    }
  }

  function applyPlan(next: DiscoveryPlan, runNow: boolean) {
    setProvider(next.provider);
    setCountry(next.country);
    setCity(next.city);
    setCategories(next.categories);
    setLimit(String(next.limit));
    setResult(null);
    if (runNow) {
      void run({
        provider: next.provider,
        country: next.country,
        city: next.city,
        categories: next.categories,
        limit: next.limit,
      });
    } else {
      toast.success("Plan applied to the form. Review the filters, then run discovery.");
      void previewArea(next.city, next.country, { silent: true });
    }
  }

  async function run(overrides?: RunOverrides) {
    const request: RunOverrides = overrides ?? {
      provider,
      country: country.trim(),
      city: city.trim(),
      categories,
      limit: Number(limit) || 50,
    };
    if (
      request.provider === "google_places" &&
      !data.providers.find((item) => item.id === "google_places")?.available
    ) {
      toast.error("Google Places is not configured. Add GOOGLE_PLACES_API_KEY to enable it.");
      return;
    }
    if (!request.city) {
      toast.error("Enter a city.");
      return;
    }
    if (!request.categories.length) {
      toast.error("Choose at least one category.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const response = await apiFetch<{ result: DiscoveryResult }>("/api/discovery", {
        method: "POST",
        body: JSON.stringify({
          ...request,
          saveSearch,
        }),
      });
      setResult(response.result);
      if (response.result.mapped.length) {
        setMapMarkers(response.result.mapped);
        setMapBounds(null);
        setMapCenter({
          lat: response.result.mapped[0]?.lat ?? 0,
          lng: response.result.mapped[0]?.lng ?? 0,
        });
        setMapLabel(`${request.city}, ${request.country}`.replace(/,\s*$/, ""));
      }
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

  const mappedLabel = result?.mapped.length
    ? `${result.mapped.length} of ${result.found} results have coordinates from the source.`
    : "Approximate search area. Results will appear here when the source returns coordinates.";

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="Live sources"
        title="Discovery"
        description="Describe who you want, preview the area on a real map, and import live businesses from public sources. AI only plans the search — it never invents leads."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SectionCard
            title="AI search assistant"
            description="Chat in plain language. The assistant only plans filters; every business still comes from a live source."
            actions={
              <Badge variant={anyPlannerAvailable ? "success" : "muted"}>
                <Sparkles className="size-3" />
                {anyPlannerAvailable ? "Ready" : "Not configured"}
              </Badge>
            }
          >
            <div className="space-y-3">
              {chat.length ? (
                <div className="max-h-[460px] space-y-4 overflow-y-auto rounded-xl border border-border/70 bg-muted/20 p-3">
                  {chat.map((entry, index) => (
                    <div key={entry.id} className="space-y-2">
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground">
                          {entry.prompt}
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Sparkles className="size-3" />
                        </span>
                        <div className="min-w-0 flex-1">
                          {entry.plan ? (
                            <PlanPreview plan={entry.plan} running={running} onApply={applyPlan} />
                          ) : entry.error ? (
                            <div className="rounded-2xl rounded-tl-sm border border-danger/25 bg-danger-soft px-3 py-2 text-sm text-danger">
                              {entry.error}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border/70 bg-card px-3 py-2 text-sm text-muted-foreground">
                              <Loader2 className="size-3.5 animate-spin" />
                              {planning && index === chat.length - 1
                                ? "Planning the search filters…"
                                : "No plan was returned."}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
                  <p className="text-sm font-medium">Ask for the leads you want.</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    For example: “Family dentists and orthodontists in Lisbon, Portugal — about 50 leads.”
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {CHAT_EXAMPLES.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => setPrompt(example)}
                        className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (!planning && anyPlannerAvailable && prompt.trim().length >= 3) {
                      void planSearch();
                    }
                  }
                }}
                placeholder={'e.g. "Family dentists and orthodontists in Lisbon, Portugal — about 50 leads."'}
                maxLength={600}
                rows={3}
                aria-label="Describe the businesses you want to find"
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <Field label="Planner" htmlFor="discovery-planner" className="sm:max-w-[220px] sm:flex-1">
                  <Select
                    id="discovery-planner"
                    value={planner}
                    onChange={(event) => setPlanner(event.target.value as PlannerChoice)}
                  >
                    <option value="auto">Auto (fastest configured)</option>
                    {planners.map((item) => (
                      <option key={item.id} value={item.id} disabled={!item.available}>
                        {item.label}
                        {item.available ? "" : " — add key"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  type="button"
                  onClick={() => void planSearch()}
                  disabled={planning || !anyPlannerAvailable || prompt.trim().length < 3}
                >
                  {planning ? <Loader2 className="animate-spin" /> : <Wand2 />}
                  Send
                </Button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {planners.map((item) => (
                  <Badge key={item.id} variant={item.available ? "success" : "muted"}>
                    {item.label}: {item.available ? item.model : "not configured"}
                  </Badge>
                ))}
              </div>

              {!anyPlannerAvailable ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Add <code className="rounded bg-muted px-1 py-0.5">GEMINI_API_KEY</code>,{" "}
                  <code className="rounded bg-muted px-1 py-0.5">GROK_API_KEY</code> or{" "}
                  <code className="rounded bg-muted px-1 py-0.5">GROQ_API_KEY</code> to <code>.env</code> and restart
                  to enable AI planning. The manual form below still works with OpenStreetMap only.
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Press Enter to send, Shift+Enter for a new line. The assistant cannot return businesses, phone
                  numbers, emails or websites — those always come from the live source.
                </p>
              )}
            </div>
          </SectionCard>

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
                      <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                        {item.detail}
                      </span>
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
                <Field
                  label="Maximum results"
                  htmlFor="discovery-limit"
                  hint="Smaller searches are kinder to shared services."
                >
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void previewArea()}
                  disabled={locating || !city.trim()}
                >
                  {locating ? <Loader2 className="animate-spin" /> : <MapPin />} Show area on map
                </Button>
                <p className="text-xs text-muted-foreground">
                  Results are imported through the same dedupe and validation pipeline as uploads. OpenStreetMap can
                  take 30–60 seconds when the shared service is busy.
                </p>
              </div>
            </div>
          </SectionCard>

          {mapCenter || mapBounds || mapMarkers.length ? (
            <SectionCard
              title={mapMarkers.length ? "Results on the map" : "Search area"}
              description={mapMarkers.length ? mappedLabel : "Approximate area from OpenStreetMap. Zoom and pan to inspect it."}
              actions={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMapCenter(null);
                    setMapBounds(null);
                    setMapMarkers([]);
                    setMapLabel("");
                  }}
                >
                  Hide map
                </Button>
              }
            >
              <DiscoveryMap
                center={mapCenter}
                bounds={mapBounds}
                markers={mapMarkers}
                label={`Map for ${mapLabel || city || "search area"}`}
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Map data © OpenStreetMap contributors. Positions come from the selected source and are not verified
                addresses.
              </p>
            </SectionCard>
          ) : null}

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
              {result.via === "nominatim" ? (
                <p className="mb-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  Source: OpenStreetMap POI index (Nominatim) — live OpenStreetMap data, not generated.
                </p>
              ) : null}
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
                      <li
                        key={`${item.name}-${index}`}
                        className="flex items-center gap-3 py-2 text-sm first:pt-0 last:pb-0"
                      >
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
                it stays unavailable instead of showing invented businesses. AI plans filters; it is never treated as a
                business database.
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
                        <Button
                          type="button"
                          size="iconSm"
                          variant="outline"
                          onClick={() => loadSaved(search)}
                          aria-label="Use saved search"
                        >
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
                contributors, available under the ODbL. Geocoding uses Nominatim.
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> Gemini, Grok and Groq only turn your
                words into search filters. They are not lead sources and cannot add businesses.
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-success" /> Searches and geocoding are rate-limited
                to protect shared services.
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

function PlanPreview({
  plan,
  running,
  onApply,
}: {
  plan: DiscoveryPlan;
  running: boolean;
  onApply: (plan: DiscoveryPlan, runNow: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="size-3.5 text-primary" />
            {[plan.city, plan.country].filter(Boolean).join(", ")}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{plan.reasoning}</p>
        </div>
        <Badge variant="outline">
          {plan.planner} · {plan.model}
        </Badge>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {plan.categories.map((category) => (
          <Badge key={category} variant="secondary">
            {CATEGORY_OPTIONS.find((option) => option.key === category)?.label ?? category}
          </Badge>
        ))}
        <Badge variant="outline">
          {plan.provider === "osm" ? "OpenStreetMap" : "Google Places"} · up to {plan.limit}
        </Badge>
      </div>
      {plan.notes.length ? (
        <ul className="mt-2 space-y-1 text-xs text-warning">
          {plan.notes.map((note) => (
            <li key={note} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onApply(plan, false)} disabled={running}>
          Apply to form
        </Button>
        <Button type="button" size="sm" onClick={() => onApply(plan, true)} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : <Search />} Apply &amp; run
        </Button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        This is a plan, not a result list. The app will query the selected live source and import only real records.
      </p>
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
