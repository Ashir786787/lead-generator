import { afterEach, describe, expect, it, vi } from "vitest";
import {
  availablePlanner,
  normaliseCategory,
  parsePlannerOutput,
  planDiscovery,
  plannerStatuses,
} from "@/lib/discovery/ai";
import { parseGeocodeResults } from "@/lib/discovery/geocode";
import { env } from "@/lib/env";

describe("AI planner category normalisation", () => {
  it("maps common plural and alias names onto supported keys", () => {
    expect(normaliseCategory("Restaurants")).toBe("restaurant");
    expect(normaliseCategory("orthodontists")).toBe("dentist");
    expect(normaliseCategory("real estate agency")).toBe("real_estate");
    expect(normaliseCategory("Law Firms")).toBe("law_firm");
    expect(normaliseCategory("gyms")).toBe("gym");
  });

  it("rejects categories the app cannot search", () => {
    expect(normaliseCategory("spaceship dealership")).toBeNull();
    expect(normaliseCategory("")).toBeNull();
  });
});

describe("parsePlannerOutput", () => {
  it("accepts fenced JSON and removes unsupported categories", () => {
    const plan = parsePlannerOutput(
      '```json\n{"city":"Lisbon","country":"Portugal","categories":["dentists","spaceships"],"limit":100,"reasoning":"Dental clinics."}\n```',
    );
    expect(plan.city).toBe("Lisbon");
    expect(plan.country).toBe("Portugal");
    expect(plan.categories).toEqual(["dentist"]);
    expect(plan.limit).toBe(100);
    expect(plan.provider).toBe("osm");
    expect(plan.notes.join(" ")).toMatch(/spaceships/i);
  });

  it("accepts a nested plan object and defaults the limit", () => {
    const plan = parsePlannerOutput(
      JSON.stringify({
        plan: { city: "Berlin", country: "Germany", categories: ["cafe", "bakery"] },
      }),
    );
    expect(plan.city).toBe("Berlin");
    expect(plan.categories).toEqual(["cafe"]);
    expect(plan.limit).toBe(50);
  });

  it("falls back to OpenStreetMap when Google Places has no key", () => {
    const plan = parsePlannerOutput(
      JSON.stringify({
        city: "Lisbon",
        country: "Portugal",
        categories: ["restaurant"],
        targetProvider: "google_places",
      }),
    );
    expect(plan.provider).toBe("osm");
    expect(plan.notes.join(" ")).toMatch(/Google Places is not configured/i);
  });

  it("asks for a location instead of inventing one", () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify({ city: "", country: "", categories: ["dentist"] })),
    ).toThrow(/missing a location/i);
  });

  it("rejects a plan with no supported categories", () => {
    expect(() =>
      parsePlannerOutput(
        JSON.stringify({ city: "Lisbon", country: "Portugal", categories: ["spaceships"] }),
      ),
    ).toThrow(/business type/i);
  });

  it("rejects malformed output", () => {
    expect(() => parsePlannerOutput("I cannot help with that.")).toThrow(/JSON plan/i);
  });
});

describe("planner availability", () => {
  it("is honest when no keys are configured", () => {
    const statuses = plannerStatuses();
    expect(statuses.map((item) => item.id)).toEqual(["gemini", "grok"]);
    expect(statuses.every((item) => item.available)).toBe(false);
    expect(availablePlanner("auto")).toBeNull();
    expect(availablePlanner("grok")).toBeNull();
  });
});

describe("planDiscovery provider calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    (env.gemini as { apiKey: string }).apiKey = "";
    (env.grok as { apiKey: string }).apiKey = "";
  });

  it("sends Gemini a JSON-only plan request and validates the answer", async () => {
    (env.gemini as { apiKey: string }).apiKey = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      city: "Lisbon",
                      country: "Portugal",
                      categories: ["dentists"],
                      limit: 100,
                      reasoning: "Dental practices.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plan = await planDiscovery({ prompt: "dentists in Lisbon, Portugal", planner: "gemini" });

    expect(plan).toMatchObject({
      planner: "gemini",
      model: env.gemini.model,
      city: "Lisbon",
      country: "Portugal",
      categories: ["dentist"],
      limit: 100,
    });
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain("generativelanguage.googleapis.com");
    const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as {
      generationConfig?: { responseMimeType?: string };
      systemInstruction?: { parts?: Array<{ text?: string }> };
    };
    expect(body.generationConfig?.responseMimeType).toBe("application/json");
    expect(body.systemInstruction?.parts?.[0]?.text).toMatch(/never invent/i);
  });

  it("rejects an unconfigured planner without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(planDiscovery({ prompt: "dentists in Lisbon", planner: "grok" })).rejects.toThrow(
      /not configured/i,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("geocode result parsing", () => {
  it("converts Nominatim strings into typed coordinates and bounds", () => {
    const results = parseGeocodeResults([
      {
        display_name: "Lisbon, Portugal",
        lat: "38.7077507",
        lon: "-9.1365919",
        boundingbox: ["38.6867", "38.7964", "-9.2294", "-9.0905"],
        address: { city: "Lisbon", country: "Portugal", country_code: "pt" },
      },
      { display_name: "Broken", lat: "not-a-number", lon: "0" },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      displayName: "Lisbon, Portugal",
      city: "Lisbon",
      country: "Portugal",
      lat: 38.7077507,
      lng: -9.1365919,
      bounds: { south: 38.6867, west: -9.2294, north: 38.7964, east: -9.0905 },
    });
  });

  it("throws a clear error for an unexpected payload", () => {
    expect(() => parseGeocodeResults({ error: "nope" })).toThrow(/unexpected response/i);
  });
});
