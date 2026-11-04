import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoveryCaches,
  discoverOsmRecords,
  searchOsmRecords,
  type DiscoveryRequest,
} from "@/lib/discovery/service";
import { env } from "@/lib/env";

const request: DiscoveryRequest = {
  provider: "osm",
  country: "Portugal",
  city: "Lisbon",
  categories: ["dentist"],
  limit: 20,
};

function overpassBody(elements: unknown[]): string {
  return JSON.stringify({ elements });
}

const element = {
  type: "node",
  id: 123,
  lat: 38.7223,
  lon: -9.1393,
  tags: {
    name: "Fixture Dental Studio",
    amenity: "dentist",
    website: "https://example.com",
    "addr:street": "Rua Augusta",
    "addr:housenumber": "10",
  },
};

describe("OpenStreetMap discovery resilience", () => {
  beforeEach(() => {
    clearDiscoveryCaches();
    // Exercise retries in unit tests; the shipped default is one attempt per
    // mirror so a busy Overpass fails over to Nominatim quickly.
    (env.overpass as { retries: number }).retries = 2;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env.overpass as { retries: number }).retries = 0;
  });

  it("retries a transient 503 and parses real elements", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(overpassBody([element, { type: "node", id: 9, tags: {} }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const records = await searchOsmRecords(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      name: "Fixture Dental Studio",
      city: "Lisbon",
      country: "Portugal",
      lat: 38.7223,
      lng: -9.1393,
      sourceId: "osm:node/123",
    });
  });

  it("serves a repeated query from the in-memory cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(overpassBody([element]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await searchOsmRecords(request);
    await searchOsmRecords(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an honest error after every attempt fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchOsmRecords(request)).rejects.toThrow(/could not be reached/i);
    await expect(searchOsmRecords(request)).rejects.toThrow(/HTTP 502/);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("treats an Overpass remark error as retryable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [], remark: "runtime error: query timed out" }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(overpassBody([element]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const records = await searchOsmRecords(request);
    expect(records).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries HTTP 400 when Overpass reports a runtime/queue error", async () => {
    const busyPage =
      "<html><body><h1>Bad Request</h1><p>runtime error: Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy.</p></body></html>";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(busyPage, { status: 400 }))
      .mockResolvedValueOnce(new Response(overpassBody([element]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const records = await searchOsmRecords(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(records).toHaveLength(1);
  });

  it("does not retry a genuine HTTP 400 query error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("parse error: unexpected token", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchOsmRecords(request)).rejects.toThrow(/HTTP 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("OpenStreetMap Nominatim fallback", () => {
  const geocodePayload = [
    {
      display_name: "Lisboa, Portugal",
      lat: "38.7223",
      lon: "-9.1393",
      osm_type: "relation",
      osm_id: 5400890,
      boundingbox: ["38.6914", "38.7968", "-9.2298", "-9.0863"],
      address: { city: "Lisboa", country: "Portugal" },
    },
  ];

  const poiPayload = [
    {
      place_id: 1,
      osm_type: "way",
      osm_id: 183668305,
      lat: "38.7385",
      lon: "-9.1614",
      category: "amenity",
      type: "dentist",
      name: "Fixture Dental Studio",
      display_name: "Fixture Dental Studio, Avenida X, Lisboa, Portugal",
      address: {
        house_number: "50",
        road: "Avenida X",
        city: "Lisboa",
        country: "Portugal",
      },
      extratags: { website: "https://fixture.example", phone: "+351 123" },
    },
    {
      place_id: 2,
      osm_type: "node",
      osm_id: 99,
      lat: "38.71",
      lon: "-9.15",
      category: "boundary",
      type: "administrative",
      name: "Lisboa",
      display_name: "Lisboa, Portugal",
    },
  ];

  beforeEach(() => {
    clearDiscoveryCaches();
    (env.overpass as { retries: number }).retries = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    (env.overpass as { retries: number }).retries = 0;
  });

  it("uses the OSM POI index before calling Overpass", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "nominatim.openstreetmap.org") {
        const query = url.searchParams.get("q") ?? "";
        if (query === "[amenity=dentist]") {
          return Promise.resolve(
            new Response(JSON.stringify(poiPayload), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        if (query.includes("dentist")) {
          return Promise.resolve(
            new Response(JSON.stringify([]), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(geocodePayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response("server at capacity", { status: 502 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await discoverOsmRecords(request);

    expect(outcome.via).toBe("nominatim");
    expect(outcome.note).toBeNull();
    expect(outcome.records).toHaveLength(1);
    expect(outcome.records[0]).toMatchObject({
      name: "Fixture Dental Studio",
      category: "dentist",
      website: "https://fixture.example",
      phone: "+351 123",
      street: "50 Avenida X",
      city: "Lisboa",
      country: "Portugal",
      lat: 38.7385,
      lng: -9.1614,
      sourceId: "osm:way/183668305",
    });
    // Geocode plus POI tag queries; Overpass is not touched.
    expect(
      fetchMock.mock.calls.every((call) => !String(call[0]).includes("overpass")),
    ).toBe(true);
  });

  it("treats Nominatim's 'unable to geocode' reply as an empty result", async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "nominatim.openstreetmap.org") {
        const query = url.searchParams.get("q") ?? "";
        if (query.includes("dentist")) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: "Unable to geocode" }), { status: 200 }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify(geocodePayload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(overpassBody([element]), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await discoverOsmRecords(request);

    // No POI matches, so Overpass is the backup and returns the fixture.
    expect(outcome.via).toBe("overpass");
    expect(outcome.records).toHaveLength(1);
  });

  it("reports an honest combined error when both sources fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("server at capacity", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(discoverOsmRecords(request)).rejects.toThrow(
      /could not be reached[\s\S]*Nominatim POI index also failed/i,
    );
  });
});
