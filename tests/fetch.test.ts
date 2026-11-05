import dns from "node:dns/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server";

// Must be set before the fetcher module (and therefore `src/lib/env.ts`) loads.
process.env.ALLOW_PRIVATE_TARGETS_FOR_TESTS = "true";

const { fetchPage, resetFetchState } = await import("@/lib/scan/fetch");

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
  resetFetchState();
});

afterAll(async () => {
  await server.close();
});

describe("fetchPage against a loopback fixture site", () => {
  it("fetches and returns HTML from an allowed page", async () => {
    const page = await fetchPage(`${server.url}/`);
    expect(page.failure).toBeNull();
    expect(page.status).toBe(200);
    expect(page.contentType).toBe("text/html");
    expect(page.body).toContain("Fixture Dental Studio");
    expect(page.fromCache).toBe(false);
  });

  it("keeps the original hostname in the Host header while connecting to the validated IP", async () => {
    const port = new URL(server.url).port;
    const lookup = vi
      .spyOn(dns, "lookup")
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    try {
      const page = await fetchPage(`http://fixture.test:${port}/host`);
      expect(page.failure).toBeNull();
      expect(page.body).toContain(`host=fixture.test:${port}`);
    } finally {
      lookup.mockRestore();
    }
  });

  it("obeys robots.txt disallow rules", async () => {
    const page = await fetchPage(`${server.url}/private`);
    expect(page.failure).toBe("blocked_by_robots");
    expect(page.body).toBeNull();
    expect(page.error).toMatch(/robots\.txt/i);
  });

  it("obeys robots.txt allow rules that override a broader disallow", async () => {
    const page = await fetchPage(`${server.url}/private/public`);
    expect(page.failure).toBeNull();
    expect(page.body).toContain("Public inside private");
  });

  it("follows same-site redirects", async () => {
    const page = await fetchPage(`${server.url}/redirect-internal`);
    expect(page.failure).toBeNull();
    expect(page.finalUrl).toBe(`${server.url}/about`);
    expect(page.body).toContain("Our story");
  });

  it("refuses cross-domain redirects", async () => {
    const page = await fetchPage(`${server.url}/redirect-external`);
    expect(page.failure).toBe("rejected_url");
    expect(page.error).toMatch(/different domain/i);
  });

  it("rejects non-HTML responses", async () => {
    const page = await fetchPage(`${server.url}/file.json`);
    expect(page.failure).toBe("non_html");
    expect(page.body).toBeNull();
  });

  it("reports HTTP failures without a body", async () => {
    const page = await fetchPage(`${server.url}/missing`);
    expect(page.failure).toBe("unreachable");
    expect(page.status).toBe(404);
    expect(page.body).toBeNull();
  });

  it("rejects malformed URLs before any network call", async () => {
    const page = await fetchPage("not a url");
    expect(page.failure).toBe("rejected_url");
    expect(page.status).toBeNull();
  });
});
