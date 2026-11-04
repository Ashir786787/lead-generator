const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const JUNK_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
]);

const JUNK_LOCAL_PARTS = new Set(["noreply", "no-reply", "donotreply", "do-not-reply", "test"]);

export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  let raw = value.trim().replace(/^mailto:/i, "");
  raw = raw.split("?")[0]?.trim() ?? "";
  raw = raw.replace(/^["']|["']$/g, "");
  if (!EMAIL_PATTERN.test(raw)) return null;
  return raw.toLowerCase();
}

export function isJunkEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (!email) return true;
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (JUNK_DOMAINS.has(domain)) return true;
  if (JUNK_LOCAL_PARTS.has(local)) return true;
  if (/\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i.test(email)) return true;
  if (domain.endsWith(".wixpress.com")) return true;
  if (/(^|\.)sentry\.io$/.test(domain)) return true;
  if (local.length > 64) return true;
  return false;
}

export function isNoreply(value: string): boolean {
  const email = normalizeEmail(value);
  if (!email) return false;
  return JUNK_LOCAL_PARTS.has(email.split("@")[0] ?? "");
}
