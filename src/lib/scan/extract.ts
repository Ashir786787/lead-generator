import { load } from "cheerio";
import signatures from "./signatures.json";
import { isJunkEmail, normalizeEmail } from "@/lib/normalize/email";
import { normalizePhone } from "@/lib/normalize/phone";
import { normalizeWebsite } from "@/lib/normalize/website";

export interface ChatWidgetMatch {
  name: string;
  evidence: string;
  confidence: "high" | "medium" | "low";
}

export interface FoundEmail {
  value: string;
  source: "mailto" | "text";
  evidence: string;
}

export interface FoundPhone {
  raw: string;
  e164: string | null;
  kind: "mobile" | "fixed_line" | "unknown";
  evidence: string;
}

export interface FoundWhatsapp {
  value: string;
  e164: string | null;
  evidence: string;
}

export interface FoundSocial {
  platform: string;
  url: string;
}

export interface PageLink {
  href: string;
  text: string;
}

export interface PageExtraction {
  url: string;
  title: string | null;
  lang: string | null;
  generator: string | null;
  platform: string | null;
  platformConfidence: "high" | "medium" | "low" | null;
  chatWidgets: ChatWidgetMatch[];
  emails: FoundEmail[];
  phones: FoundPhone[];
  whatsapps: FoundWhatsapp[];
  socials: FoundSocial[];
  hasBooking: boolean;
  hasInquiryForm: boolean;
  hasContactForm: boolean;
  links: PageLink[];
}

const SIGNATURES: Array<{ name: string; domains: string[]; patterns: string[] }> = signatures;

const SOCIAL_PLATFORMS: Array<{ platform: string; hosts: string[] }> = [
  { platform: "Facebook", hosts: ["facebook.com", "fb.com"] },
  { platform: "Instagram", hosts: ["instagram.com"] },
  { platform: "LinkedIn", hosts: ["linkedin.com"] },
  { platform: "X", hosts: ["twitter.com", "x.com"] },
  { platform: "TikTok", hosts: ["tiktok.com"] },
  { platform: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "Pinterest", hosts: ["pinterest.com"] },
  { platform: "Snapchat", hosts: ["snapchat.com"] },
  { platform: "Threads", hosts: ["threads.net"] },
];

const BOOKING_HOSTS = [
  "calendly.com",
  "cal.com",
  "booksy.com",
  "fresha.com",
  "setmore.com",
  "acuityscheduling.com",
  "squareup.com/appointments",
  "opentable.com",
  "resy.com",
  "sevenrooms.com",
  "treatwell.com",
  "booking.com",
  "getbob.com",
  "bookings.page",
  "mindbodyonline.com",
  "vagaro.com",
  "zocdoc.com",
  "doctolib.",
  "practo.com",
];

const BOOKING_TEXT = [
  "book now",
  "book an appointment",
  "book appointment",
  "book online",
  "schedule a call",
  "schedule an appointment",
  "schedule appointment",
  "make an appointment",
  "request an appointment",
  "reserve a table",
  "reserve now",
  "check availability",
];

const CHAT_IFRAME_HINTS = ["intercom", "crisp", "tawk", "tidio", "drift", "livechat", "zendesk", "chatwoot"];

function attr($: ReturnType<typeof load>, element: unknown, name: string): string {
  const value = $(element as never).attr(name);
  return typeof value === "string" ? value.trim() : "";
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function detectChatWidgets(html: string, $: ReturnType<typeof load>): ChatWidgetMatch[] {
  const lower = html.toLowerCase();
  const sources = [
    ...$("script[src]")
      .map((_index, element) => attr($, element, "src"))
      .get(),
    ...$("iframe[src]")
      .map((_index, element) => attr($, element, "src"))
      .get(),
  ].map((value) => value.toLowerCase());

  const found = new Map<string, ChatWidgetMatch>();
  for (const signature of SIGNATURES) {
    let evidence: string | null = null;
    let confidence: "high" | "medium" | "low" = "low";

    for (const domain of signature.domains) {
      const match = sources.find((source) => source.includes(domain));
      if (match) {
        evidence = `Loaded from ${domain}`;
        confidence = "high";
        break;
      }
    }
    if (!evidence) {
      for (const domain of signature.domains) {
        if (lower.includes(domain)) {
          evidence = `Page references ${domain}`;
          confidence = "medium";
          break;
        }
      }
    }
    if (!evidence) {
      for (const pattern of signature.patterns) {
        try {
          const regex = new RegExp(pattern, "i");
          const match = regex.exec(html);
          if (match) {
            evidence = `Inline setup found: ${cleanText(match[0]).slice(0, 90)}`;
            confidence = "medium";
            break;
          }
        } catch {
          /* ignore a malformed signature in the data file */
        }
      }
    }
    if (evidence && !found.has(signature.name)) {
      found.set(signature.name, { name: signature.name, evidence, confidence });
    }
  }
  return [...found.values()];
}

function detectPlatform(html: string, generator: string | null): { platform: string | null; confidence: "high" | "medium" | "low" | null } {
  const lower = html.toLowerCase();
  const checks: Array<{ name: string; markers: string[] }> = [
    { name: "WordPress", markers: ["wp-content", "wp-includes", "/wp-json"] },
    { name: "Wix", markers: ["wixstatic.com", "parastorage.com", "wix-code"] },
    { name: "Squarespace", markers: ["squarespace.com", "static1.squarespace.com", "squarespace-cdn.com"] },
    { name: "Webflow", markers: ["webflow.com", "assets.website-files.com"] },
    { name: "Shopify", markers: ["cdn.shopify.com", "shopify.theme", "myshopify.com"] },
    { name: "Duda", markers: ["dudaone.com", "cdn.duda.co", "duda.co"] },
    { name: "GoDaddy Website Builder", markers: ["godaddy.com/websites", "img1.wsimg.com"] },
    { name: "HubSpot CMS", markers: ["hs-sites.com", "hubspotusercontent"] },
    { name: "Drupal", markers: ["drupal.org", "/sites/default/files"] },
    { name: "Joomla", markers: ["/media/jui/", "joomla"] },
    { name: "Ghost", markers: ["ghost.io", "ghost.org"] },
    { name: "Google Sites", markers: ["sites.google.com"] },
    { name: "Framer", markers: ["framerusercontent.com", "framer.com"] },
  ];
  const generatorLower = generator?.toLowerCase() ?? "";
  for (const check of checks) {
    if (generatorLower.includes(check.name.toLowerCase())) {
      return { platform: check.name, confidence: "high" };
    }
    const hits = check.markers.filter((marker) => lower.includes(marker));
    if (hits.length) {
      return { platform: check.name, confidence: hits.length > 1 ? "high" : "medium" };
    }
  }
  if (lower.includes("__next_data__")) return { platform: "Next.js", confidence: "medium" };
  if (lower.includes("nuxt")) return { platform: "Nuxt", confidence: "low" };
  return { platform: null, confidence: null };
}

function hostOf(url: string): string | null {
  const normalized = normalizeWebsite(url);
  return normalized ? normalized.host : null;
}

function socialPlatform(url: string): string | null {
  const host = hostOf(url);
  if (!host) return null;
  const bare = host.replace(/^www\./, "");
  for (const entry of SOCIAL_PLATFORMS) {
    if (entry.hosts.some((candidate) => bare === candidate || bare.endsWith(`.${candidate}`))) {
      return entry.platform;
    }
  }
  return null;
}

function isShareOrRoot(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, "");
  if (!path) return true;
  const lower = url.toString().toLowerCase();
  if (lower.includes("sharer") || lower.includes("/intent/tweet") || lower.includes("/share")) return true;
  return false;
}

export function extractPage(html: string, pageUrl: string, country?: string | null): PageExtraction {
  const $ = load(html);
  const title = cleanText($("title").first().text()) || null;
  const lang = attr($, $("html").first(), "lang") || null;
  const generator = attr($, $('meta[name="generator"]'), "content") || null;
  const platform = detectPlatform(html, generator);

  const emails = new Map<string, FoundEmail>();
  $('a[href^="mailto:" i]').each((_index, element) => {
    const href = attr($, element, "href");
    const value = normalizeEmail(href.replace(/^mailto:/i, "").split(",")[0] ?? "");
    if (value && !isJunkEmail(value) && !emails.has(value)) {
      emails.set(value, { value, source: "mailto", evidence: cleanText(href).slice(0, 160) });
    }
  });
  const bodyText = cleanText($("body").text());
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const match of bodyText.match(emailPattern) ?? []) {
    const value = normalizeEmail(match);
    if (value && !isJunkEmail(value) && !emails.has(value) && emails.size < 12) {
      emails.set(value, { value, source: "text", evidence: match.slice(0, 160) });
    }
  }

  const phones = new Map<string, FoundPhone>();
  $('a[href^="tel:" i]').each((_index, element) => {
    const href = attr($, element, "href");
    const raw = href.replace(/^tel:/i, "").trim();
    const parsed = normalizePhone(raw, country);
    const key = parsed?.e164 ?? raw.replace(/[^\d+]/g, "");
    if (key && !phones.has(key)) {
      phones.set(key, {
        raw,
        e164: parsed?.e164 ?? null,
        kind: parsed?.kind ?? "unknown",
        evidence: cleanText(href).slice(0, 160),
      });
    }
  });

  const whatsapps = new Map<string, FoundWhatsapp>();
  $("a[href]").each((_index, element) => {
    const href = attr($, element, "href");
    const lower = href.toLowerCase();
    if (!lower.includes("wa.me") && !lower.includes("api.whatsapp.com") && !lower.startsWith("whatsapp://") && !lower.includes("web.whatsapp.com")) return;
    let number: string | null = null;
    try {
      const url = new URL(href, pageUrl);
      number = url.searchParams.get("phone");
      if (!number) {
        const segments = url.pathname.split("/").filter(Boolean);
        const candidate = segments.find((segment) => /^\+?\d{6,}$/.test(segment));
        number = candidate ?? null;
      }
    } catch {
      const match = href.match(/(?:\+?\d[\d\s-]{6,})/);
      number = match?.[0] ?? null;
    }
    const parsed = number ? normalizePhone(number, country) : null;
    const key = parsed?.e164 ?? href;
    if (!whatsapps.has(key)) {
      whatsapps.set(key, {
        value: href,
        e164: parsed?.e164 ?? null,
        evidence: cleanText(href).slice(0, 160),
      });
    }
  });

  const socials = new Map<string, FoundSocial>();
  let hasBooking = false;
  let hasContactForm = false;
  let hasInquiryForm = false;
  const links: PageLink[] = [];
  const socialKeys = new Set<string>();

  $("a[href]").each((_index, element) => {
    const href = attr($, element, "href");
    if (!href || href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) return;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    const text = cleanText($(element as never).text()).slice(0, 120);
    const platform = socialPlatform(url.toString());
    if (platform && !isShareOrRoot(url)) {
      const key = `${platform}:${url.toString()}`;
      if (!socialKeys.has(key) && socials.size < 15) {
        socialKeys.add(key);
        socials.set(key, { platform, url: url.toString() });
      }
    }
    const lowerHref = url.toString().toLowerCase();
    const lowerText = text.toLowerCase();
    if (
      BOOKING_HOSTS.some((host) => lowerHref.includes(host)) ||
      BOOKING_TEXT.some((phrase) => lowerText.includes(phrase))
    ) {
      hasBooking = true;
    }
    if (url.origin === new URL(pageUrl).origin) {
      links.push({ href: url.toString(), text });
    }
  });

  $("iframe[src]").each((_index, element) => {
    const src = attr($, element, "src");
    if (!src) return;
    const lower = src.toLowerCase();
    if (BOOKING_HOSTS.some((host) => lower.includes(host))) hasBooking = true;
    if (CHAT_IFRAME_HINTS.some((hint) => lower.includes(hint))) {
      // Chat iframe presence is captured by signature detection on the full HTML.
    }
  });

  $("form").each((_index, element) => {
    const action = attr($, element, "action").toLowerCase();
    const method = attr($, element, "method").toLowerCase();
    const hasEmailInput = $(element as never).find('input[type="email"], input[name*="email" i], input[name*="mail" i]').length > 0;
    const hasTextarea = $(element as never).find("textarea").length > 0;
    if (hasEmailInput || hasTextarea || action.includes("contact") || action.includes("quote") || action.includes("enquiry") || action.includes("inquiry")) {
      hasContactForm = true;
    }
    if (hasTextarea && (hasEmailInput || method === "post" || action.includes("contact") || action.includes("quote"))) {
      hasInquiryForm = true;
    }
  });

  return {
    url: pageUrl,
    title,
    lang,
    generator,
    platform: platform.platform,
    platformConfidence: platform.confidence,
    chatWidgets: detectChatWidgets(html, $),
    emails: [...emails.values()],
    phones: [...phones.values()],
    whatsapps: [...whatsapps.values()],
    socials: [...socials.values()],
    hasBooking,
    hasInquiryForm,
    hasContactForm,
    links: links.slice(0, 300),
  };
}
