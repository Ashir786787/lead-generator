import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoveryCaches,
  searchOsmRecords,
  type DiscoveryRequest,
} from "@/lib/discovery/service";

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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
});
