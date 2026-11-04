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

  it("accepts a city without a country and records a note", () => {
    const plan = parsePlannerOutput(
      JSON.stringify({ city: "Lisbon", categories: ["dentist"], limit: 50 }),
    );
    expect(plan.city).toBe("Lisbon");
    expect(plan.country).toBe("");
    expect(plan.notes.join(" ")).toMatch(/no country given/i);
  });

  it("asks for a city instead of inventing one", () => {
    expect(() =>
      parsePlannerOutput(JSON.stringify({ city: "", country: "", categories: ["dentist"] })),
    ).toThrow(/missing a city/i);
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
    expect(statuses.map((item) => item.id)).toEqual(["gemini", "grok", "groq"]);
    expect(statuses.every((item) => item.available)).toBe(false);
    expect(availablePlanner("auto")).toBeNull();
    expect(availablePlanner("grok")).toBeNull();
    expect(availablePlanner("groq")).toBeNull();
  });
});

describe("planDiscovery provider calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    (env.gemini as { apiKey: string }).apiKey = "";
    (env.grok as { apiKey: string }).apiKey = "";
    (env.groq as { apiKey: string }).apiKey = "";
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

  it("calls Groq's OpenAI-compatible endpoint with JSON mode", async () => {
    (env.groq as { apiKey: string }).apiKey = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  city: "Berlin",
                  country: "Germany",
                  categories: ["cafes"],
                  limit: 20,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const plan = await planDiscovery({ prompt: "cafes in Berlin, Germany", planner: "groq" });

    expect(plan).toMatchObject({
      planner: "groq",
      model: env.groq.model,
      city: "Berlin",
      country: "Germany",
      categories: ["cafe"],
      limit: 20,
    });
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toContain("api.groq.com/openai/v1/chat/completions");
    const headers = (call?.[1] as RequestInit | undefined)?.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer test-key$/);
    const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body)) as {
      response_format?: { type?: string };
      model?: string;
    };
    expect(body.response_format?.type).toBe("json_object");
    expect(body.model).toBe(env.groq.model);
  });

  it("auto mode stops on an invalid plan instead of trying more providers", async () => {
    (env.gemini as { apiKey: string }).apiKey = "test-gemini";
    (env.groq as { apiKey: string }).apiKey = "test-groq";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ city: "", country: "", categories: ["dentist"] }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(planDiscovery({ prompt: "dentists nearby", planner: "auto" })).rejects.toThrow(
      /missing a city/i,
    );
    // Groq is first; the 400 stops the chain before Gemini is called.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("auto mode falls back to the next configured planner", async () => {
    (env.gemini as { apiKey: string }).apiKey = "test-gemini";
    (env.groq as { apiKey: string }).apiKey = "test-groq";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 }),
      )
      .mockResolvedValueOnce(
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
                        categories: ["dentist"],
                        limit: 50,
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

    const plan = await planDiscovery({ prompt: "dentists in Lisbon, Portugal", planner: "auto" });

    expect(plan.planner).toBe("gemini");
    expect(plan.city).toBe("Lisbon");
    expect(plan.notes.join(" ")).toMatch(/fell back to Gemini/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
