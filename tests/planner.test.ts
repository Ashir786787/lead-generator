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

  it("answers general questions with advice and no search filters", () => {
    const reply = parsePlannerOutput(
      JSON.stringify({
        intent: "advice",
        answer:
          "Start with businesses that already pay for marketing and depend on inbound enquiries, such as dentists, clinics and law firms. A good lead is reachable and shows a gap you can help with.",
        city: "",
        country: "",
        categories: [],
      }),
    );
    expect(reply.intent).toBe("advice");
    expect(reply.answer).toMatch(/dentists, clinics and law firms/i);
    expect(reply.categories).toEqual([]);
    expect(reply.city).toBe("");
    expect(reply.answer).not.toMatch(/Lisbon/);
  });

  it("falls back to useful guidance when advice has no text", () => {
    const reply = parsePlannerOutput(
      JSON.stringify({ intent: "advice", answer: "", city: "", categories: [] }),
    );
    expect(reply.intent).toBe("advice");
    expect(reply.answer).toMatch(/tell me what you sell|business type/i);
  });

  it("asks for a city instead of inventing one", () => {
    const reply = parsePlannerOutput(
      JSON.stringify({ city: "", country: "", categories: ["dentist"] }),
    );
    expect(reply.intent).toBe("advice");
    expect(reply.answer).toMatch(/which city/i);
    expect(reply.answer).toMatch(/dentist/i);
    expect(reply.city).toBe("");
  });

  it("guides the user when no supported category was given", () => {
    const reply = parsePlannerOutput(
      JSON.stringify({
        city: "Lisbon",
        country: "Portugal",
        categories: ["spaceships"],
      }),
    );
    expect(reply.intent).toBe("advice");
    expect(reply.answer).toMatch(/business type/i);
    expect(reply.answer).toMatch(/dentist|restaurant/i);
    expect(reply.categories).toEqual([]);
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

  it("forwards recent conversation turns to OpenAI-compatible planners", async () => {
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
                  categories: ["restaurant", "salon", "clinic"],
                  limit: 50,
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await planDiscovery({
      prompt: "Berlin",
      planner: "groq",
      history: [
        { role: "user", content: "what kind of leads are helpful for a web design studio?" },
        {
          role: "assistant",
          content: "Good targets include restaurants, salons and clinics. Which city?",
        },
        { role: "user", content: "I sell web design services" },
        { role: "user", content: "Berlin" },
      ],
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { messages?: Array<{ role: string; content: string }> };
    expect(body.messages).toHaveLength(6); // system + 4 history turns + current message
    expect(body.messages?.[1]).toMatchObject({ role: "user" });
    expect(body.messages?.[1]?.content).toMatch(/web design studio/i);
    expect(body.messages?.[2]).toMatchObject({ role: "assistant" });
    expect(body.messages?.at(-1)?.content).toMatch(/Berlin/);
  });

  it("maps conversation history to Gemini user and model turns", async () => {
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
                      city: "Berlin",
                      country: "Germany",
                      categories: ["restaurant"],
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

    await planDiscovery({
      prompt: "Berlin",
      planner: "gemini",
      history: [
        { role: "user", content: "which businesses are good leads?" },
        { role: "assistant", content: "Restaurants and salons. Which city?" },
      ],
    });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as { contents?: Array<{ role: string }> };
    expect(body.contents?.map((item) => item.role)).toEqual(["user", "model", "user"]);
  });

  it("auto mode answers a missing-city request without retrying other providers", async () => {
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

    const reply = await planDiscovery({ prompt: "dentists nearby", planner: "auto" });

    expect(reply.intent).toBe("advice");
    expect(reply.answer).toMatch(/which city/i);
    // Groq is first; the reply is valid guidance, so Gemini is never called.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns advice from the provider without building a plan", async () => {
    (env.groq as { apiKey: string }).apiKey = "test-key";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "advice",
                  answer:
                    "Think about businesses with repeat customers and a reason to invest in outreach, such as dentists, gyms and law firms. Tell me what you sell and I can narrow that down.",
                  city: "",
                  country: "",
                  categories: [],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reply = await planDiscovery({
      prompt: "what kind of leads are helpful to find business",
      planner: "groq",
    });

    expect(reply).toMatchObject({ intent: "advice", planner: "groq", city: "", categories: [] });
    expect(reply.answer).toMatch(/dentists, gyms and law firms/i);
    expect(reply.answer).not.toMatch(/[\w.-]+\.(com|net|org)/i);
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
