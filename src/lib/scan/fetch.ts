import { Agent, fetch as undiciFetch } from "undici";
import { env } from "@/lib/env";
import { sleep } from "@/lib/utils";
import { resolveScanTarget, sameSiteUrl, UnsafeTargetError } from "./ssrf";

export type FetchFailure =
  | "blocked_by_robots"
  | "unreachable"
  | "timeout"
  | "tls_error"
  | "non_html"
  | "rejected_url"
  | "error";

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  contentType: string | null;
  body: string | null;
  failure: FetchFailure | null;
  error: string | null;
  durationMs: number;
  fromCache: boolean;
}

const lastRequestByHost = new Map<string, number>();

async function waitForHost(host: string): Promise<void> {
  const delay = Math.max(0, env.scan.perHostDelayMs);
  const now = Date.now();
  const slot = Math.max(now, (lastRequestByHost.get(host) ?? 0) + delay);
  lastRequestByHost.set(host, slot);
  if (slot > now) await sleep(slot - now);
}

function pinnedUrl(url: URL, address: string): URL {
  const pinned = new URL(url.toString());
  const hostPart = address.includes(":") ? `[${address}]` : address;
  pinned.host = url.port ? `${hostPart}:${url.port}` : hostPart;
  return pinned;
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return false;
  const value = contentType.toLowerCase();
  return value.includes("text/html") || value.includes("application/xhtml+xml");
}

async function readBody(response: Awaited<ReturnType<typeof undiciFetch>>): Promise<{ body: Buffer; tooLarge: boolean }> {
  if (!response.body) return { body: Buffer.alloc(0), tooLarge: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let tooLarge = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > env.scan.maxBodyBytes) {
      tooLarge = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(Buffer.from(value));
  }
  return { body: Buffer.concat(chunks), tooLarge };
}

interface RawFetchResult {
  status: number;
  contentType: string | null;
  body: string;
  location: string | null;
  finalAddress: string;
}

async function requestOnce(url: URL): Promise<RawFetchResult> {
  const target = await resolveScanTarget(url.toString());
  let lastError: unknown = null;
  for (const entry of target.addresses.slice(0, 2)) {
    const agent = new Agent({
      connect: {
        timeout: env.scan.connectTimeoutMs,
        servername: url.protocol === "https:" ? target.hostname : undefined,
        rejectUnauthorized: true,
      },
      headersTimeout: env.scan.connectTimeoutMs,
      bodyTimeout: env.scan.totalTimeoutMs,
      keepAliveTimeout: 1_000,
    });
    try {
      await waitForHost(target.hostname);
      const response = await undiciFetch(pinnedUrl(url, entry.address), {
        method: "GET",
        redirect: "manual",
        dispatcher: agent,
        signal: AbortSignal.timeout(env.scan.totalTimeoutMs),
        headers: {
          Host: url.host,
          "User-Agent": env.scan.userAgent,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "en;q=0.8",
          "Cache-Control": "no-cache",
        },
      });
      const { body, tooLarge } = await readBody(response);
      const finalUrl = new URL(response.headers.get("location") ?? url.toString(), url).toString();
      return {
        status: response.status,
        contentType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? null,
        body: tooLarge ? "" : body.toString("utf8"),
        location: response.status >= 300 && response.status < 400 ? finalUrl : null,
        finalAddress: entry.address,
      };
    } catch (error) {
      lastError = error;
    } finally {
      await agent.close().catch(() => undefined);
    }
  }
  throw lastError ?? new Error("The request failed.");
}

function classifyError(error: unknown): FetchFailure {
  if (error instanceof UnsafeTargetError) return "rejected_url";
  const message = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("aborted")) return "timeout";
  if (message.includes("certificate") || message.includes("tls") || message.includes("ssl")) return "tls_error";
  return "unreachable";
}

/* ────────────────────────────── robots.txt ─────────────────────────────── */

interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelayMs: number | null;
  fetchedAt: number;
}

const robotsCache = new Map<string, RobotsRules>();
const ROBOTS_TTL_MS = 10 * 60 * 1000;

function matchesRule(path: string, rule: string): boolean {
  if (!rule) return false;
  const anchored = rule.endsWith("$");
  const raw = anchored ? rule.slice(0, -1) : rule;
  const pattern = raw
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
  return regex.test(path);
}

function parseRobots(text: string, userAgent: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[]; crawlDelay: number | null }> = [];
  let current: { agents: string[]; allow: string[]; disallow: string[]; crawlDelay: number | null } | null = null;
  let readingAgents = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      if (!current || !readingAgents) {
        current = { agents: [], allow: [], disallow: [], crawlDelay: null };
        groups.push(current);
        readingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    readingAgents = false;
    if (!current) continue;
    if (key === "allow") current.allow.push(value);
    if (key === "disallow") current.disallow.push(value);
    if (key === "crawl-delay") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelay = Math.min(parsed * 1000, 10_000);
    }
  }

  const token = userAgent.toLowerCase();
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && token.includes(agent)),
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const selected = specific.length ? specific : wildcard;
  return {
    allow: selected.flatMap((group) => group.allow),
    disallow: selected.flatMap((group) => group.disallow),
    crawlDelayMs: selected.find((group) => group.crawlDelay !== null)?.crawlDelay ?? null,
    fetchedAt: Date.now(),
  };
}

async function robotsFor(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached;
  const empty: RobotsRules = { allow: [], disallow: [], crawlDelayMs: null, fetchedAt: Date.now() };
  try {
    const result = await requestOnce(new URL("/robots.txt", origin));
    if (result.status >= 200 && result.status < 300) {
      const parsed = parseRobots(result.body.slice(0, 512_000), env.scan.userAgent);
      robotsCache.set(origin, parsed);
      return parsed;
    }
  } catch {
    /* robots unavailable — treat as allow, as the standard recommends for 4xx/network errors */
  }
  robotsCache.set(origin, empty);
  return empty;
}

function robotsAllows(rules: RobotsRules, path: string): boolean {
  const matchingAllow = rules.allow.filter((rule) => matchesRule(path, rule)).sort((a, b) => b.length - a.length)[0];
  const matchingDisallow = rules.disallow
    .filter((rule) => matchesRule(path, rule))
    .sort((a, b) => b.length - a.length)[0];
  if (!matchingDisallow) return true;
  if (matchingAllow && matchingAllow.length >= matchingDisallow.length) return true;
  return false;
}

/* ─────────────────────────────── public API ────────────────────────────── */

export async function fetchPage(input: string, options: { respectRobots?: boolean } = {}): Promise<FetchedPage> {
  const started = Date.now();
  let current: URL;
  try {
    current = new URL(input);
  } catch {
    return {
      requestedUrl: input,
      finalUrl: input,
      status: null,
      contentType: null,
      body: null,
      failure: "rejected_url",
      error: "The website URL is not valid.",
      durationMs: Date.now() - started,
      fromCache: false,
    };
  }

  try {
    const first = await resolveScanTarget(current.toString());
    if (options.respectRobots !== false) {
      const rules = await robotsFor(current.origin);
      if (!robotsAllows(rules, current.pathname + current.search)) {
        return {
          requestedUrl: input,
          finalUrl: current.toString(),
          status: null,
          contentType: null,
          body: null,
          failure: "blocked_by_robots",
          error: "robots.txt disallows checking this page.",
          durationMs: Date.now() - started,
          fromCache: false,
        };
      }
    }

    let hops = 0;
    let url = first.url;
    while (hops <= 5) {
      const response = await requestOnce(url);
      if (response.location) {
        const next = new URL(response.location, url);
        if (!sameSiteUrl(first.url, next)) {
          return {
            requestedUrl: input,
            finalUrl: next.toString(),
            status: response.status,
            contentType: response.contentType,
            body: null,
            failure: "rejected_url",
            error: "The site redirected to a different domain; the scan stopped for safety.",
            durationMs: Date.now() - started,
            fromCache: false,
          };
        }
        if (options.respectRobots !== false) {
          const rules = await robotsFor(next.origin);
          if (!robotsAllows(rules, next.pathname + next.search)) {
            return {
              requestedUrl: input,
              finalUrl: next.toString(),
              status: response.status,
              contentType: null,
              body: null,
              failure: "blocked_by_robots",
              error: "robots.txt disallows the redirect target.",
              durationMs: Date.now() - started,
              fromCache: false,
            };
          }
        }
        url = next;
        hops++;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        return {
          requestedUrl: input,
          finalUrl: url.toString(),
          status: response.status,
          contentType: response.contentType,
          body: null,
          failure: "unreachable",
          error: `The website returned HTTP ${response.status}.`,
          durationMs: Date.now() - started,
          fromCache: false,
        };
      }
      if (!isHtml(response.contentType)) {
        return {
          requestedUrl: input,
          finalUrl: url.toString(),
          status: response.status,
          contentType: response.contentType,
          body: null,
          failure: "non_html",
          error: `Expected an HTML page, received ${response.contentType ?? "no content type"}.`,
          durationMs: Date.now() - started,
          fromCache: false,
        };
      }
      return {
        requestedUrl: input,
        finalUrl: url.toString(),
        status: response.status,
        contentType: response.contentType,
        body: response.body,
        failure: null,
        error: null,
        durationMs: Date.now() - started,
        fromCache: false,
      };
    }
    return {
      requestedUrl: input,
      finalUrl: current.toString(),
      status: null,
      contentType: null,
      body: null,
      failure: "rejected_url",
      error: "Too many redirects.",
      durationMs: Date.now() - started,
      fromCache: false,
    };
  } catch (error) {
    return {
      requestedUrl: input,
      finalUrl: current.toString(),
      status: null,
      contentType: null,
      body: null,
      failure: classifyError(error),
      error: error instanceof Error ? error.message : "The request failed.",
      durationMs: Date.now() - started,
      fromCache: false,
    };
  }
}

/** Test-only helper: clears the in-memory politeness and robots caches. */
export function resetFetchState(): void {
  lastRequestByHost.clear();
  robotsCache.clear();
}
