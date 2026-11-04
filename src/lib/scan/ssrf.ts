import dns from "node:dns/promises";
import net from "node:net";
import { env } from "@/lib/env";
import { registrableHost } from "@/lib/normalize/website";

export interface ResolvedTarget {
  url: URL;
  hostname: string;
  registrable: string;
  addresses: Array<{ address: string; family: 4 | 6 }>;
}

export class UnsafeTargetError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function ipv4IsPrivate(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

export function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return ipv4IsPrivate(address);
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) {
      return true; // link-local fe80::/10
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("ff")) return true; // multicast
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return ipv4IsPrivate(mapped[1]);
    return false;
  }
  return true;
}

function assertHostnameAllowed(hostname: string): void {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (!lower) throw new UnsafeTargetError("The host is empty.");
  if (BLOCKED_HOSTNAMES.has(lower)) throw new UnsafeTargetError("Local and metadata hosts are blocked.");
  if (
    lower.endsWith(".localhost") ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".home.arpa")
  ) {
    throw new UnsafeTargetError("Local network hostnames are blocked.");
  }
  if (!lower.includes(".") && net.isIP(lower) === 0) {
    throw new UnsafeTargetError("The host must be a public domain name.");
  }
}

/**
 * Resolve a website URL and reject anything that could reach a private network.
 * The resolved addresses are pinned for the actual request to defeat DNS rebinding.
 */
export async function resolveScanTarget(input: string): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeTargetError("The website URL is not valid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeTargetError("Only http and https websites can be checked.");
  }
  if (url.username || url.password) {
    throw new UnsafeTargetError("URLs containing credentials are blocked.");
  }
  // URL.hostname keeps the square brackets around IPv6 literals; strip them so
  // net.isIP() recognises the address (otherwise public IPv6 sites are refused).
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  assertHostnameAllowed(hostname);

  const allowedPort = url.port === "" || url.port === "80" || url.port === "443";
  if (!allowedPort && !env.scan.allowPrivateTargetsForTests) {
    throw new UnsafeTargetError("Only standard web ports are allowed.");
  }

  const literalFamily = net.isIP(hostname);
  let addresses: Array<{ address: string; family: 4 | 6 }>;
  if (literalFamily !== 0) {
    addresses = [{ address: hostname, family: literalFamily === 6 ? 6 : 4 }];
  } else {
    try {
      const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
      addresses = resolved.map((entry) => ({
        address: entry.address,
        family: entry.family === 6 ? 6 : 4,
      }));
    } catch {
      throw new UnsafeTargetError("The website domain could not be resolved.");
    }
  }
  if (!addresses.length) throw new UnsafeTargetError("The website domain did not resolve to an address.");

  const allowPrivate = env.scan.allowPrivateTargetsForTests && !env.isProduction;
  if (!allowPrivate && addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new UnsafeTargetError("Private, loopback and link-local addresses are blocked.");
  }

  return {
    url,
    hostname,
    registrable: registrableHost(hostname),
    addresses,
  };
}

export function sameSiteUrl(a: URL, b: URL): boolean {
  return registrableHost(a.hostname) === registrableHost(b.hostname);
}
