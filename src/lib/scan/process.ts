import { collections, newId, now } from "@/lib/db";
import type { BusinessDoc, ScanResultDoc } from "@/lib/db/types";
import { fetchPage } from "./fetch";
import { extractPage, type PageExtraction } from "./extract";
import { normalizeWebsite } from "@/lib/normalize/website";
import { recalculateLeadScore } from "@/lib/score/service";
import { publishEvent } from "@/lib/events/bus";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { scanCacheCutoff } from "./service";

type ScanOutcome =
  | "success"
  | "partial"
  | "blocked_by_robots"
  | "unreachable"
  | "timeout"
  | "tls_error"
  | "non_html"
  | "rejected_url"
  | "cancelled"
  | "error";

interface PageDetail {
  url: string;
  outcome: string;
  httpStatus: number | null;
  title: string | null;
  chatWidgets: Array<{ name: string; evidence: string; confidence: string }>;
  error: string | null;
  durationMs: number;
}

interface ScanSummary {
  generator: string | null;
  booking: boolean;
  inquiryForm: boolean;
  contactForm: boolean;
  emails: string[];
  phones: string[];
  whatsapps: string[];
  socials: Array<{ platform: string; url: string }>;
  pages: PageDetail[];
}

const PRIORITY: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /contact|get-in-touch|reach-us|enquir|inquir/i, score: 100 },
  { pattern: /book|appointment|reserve|schedule|reservation/i, score: 95 },
  { pattern: /about|who-we-are|our-story/i, score: 80 },
  { pattern: /service|treatment|menu|what-we-do|offering/i, score: 60 },
  { pattern: /pricing|price|fee|cost|plans/i, score: 50 },
  { pattern: /team|staff|doctor|specialist|our-people/i, score: 45 },
  { pattern: /location|find-us|visit|showroom/i, score: 40 },
  { pattern: /faq|help/i, score: 30 },
];

const SKIP = /(log-?in|sign-?in|sign-?up|register|logout|cart|checkout|account|privacy|terms|cookie|legal|careers|jobs|wp-admin|admin|sitemap|feed|\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|mp4|mp3|css|js))(\?|$|\/)/i;

function priorityFor(url: URL): number {
  const value = `${url.pathname}${url.search}`;
  if (SKIP.test(value)) return -1;
  for (const entry of PRIORITY) {
    if (entry.pattern.test(value)) return entry.score;
  }
  return 0;
}

function choosePages(baseUrl: string, homepage: PageExtraction): string[] {
  const base = new URL(baseUrl);
  const baseSite = normalizeWebsite(base.toString())?.registrableHost;
  const seen = new Set<string>([base.toString().replace(/\/$/, "")]);
  const candidates: Array<{ url: string; score: number }> = [];
  for (const link of homepage.links) {
    try {
      const url = new URL(link.href);
      const normalized = normalizeWebsite(url.toString());
      if (!normalized || normalized.registrableHost !== baseSite) continue;
      url.hash = "";
      const clean = url.toString().replace(/\/$/, "");
      if (seen.has(clean)) continue;
      const score = priorityFor(url);
      if (score < 0) continue;
      seen.add(clean);
      candidates.push({ url: clean, score: score + (link.text.toLowerCase().includes("contact") ? 10 : 0) });
    } catch {
      continue;
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.url.length - b.url.length);
  return candidates.slice(0, Math.max(0, env.scan.maxPages - 1)).map((item) => item.url);
}

function normaliseUrlForKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export async function processScan(
  workspaceId: string,
  businessId: string,
  scanJobId: string,
  force: boolean,
): Promise<{ outcome: ScanOutcome }> {
  const started = Date.now();
  const job = await collections.scanJobs.findOne({
    workspaceId,
    _id: scanJobId,
  });
  if (!job) return { outcome: "error" };
  if (job.status === "cancelled") {
    await collections.scanJobs.updateOne(
      { workspaceId, _id: scanJobId },
      { $set: { cancelRequested: true } },
    );
    return { outcome: "cancelled" };
  }

  const business = await collections.businesses.findOne(
    { workspaceId, _id: businessId },
    {
      projection: {
        _id: 1,
        name: 1,
        websiteUrl: 1,
        country: 1,
        email: 1,
        phoneE164: 1,
        ownerId: 1,
        mergedIntoId: 1,
      },
    },
  );
  if (!business) {
    await failJob(workspaceId, scanJobId, "The lead no longer exists.");
    return { outcome: "error" };
  }
  if (!business.websiteUrl) {
    await failJob(workspaceId, scanJobId, "This lead has no website to check.");
    return { outcome: "error" };
  }

  if (!force) {
    const cached = await collections.scanResults.findOne(
      {
        workspaceId,
        businessId,
        outcome: "success",
        createdAt: { $gte: scanCacheCutoff() },
      },
      { sort: { createdAt: -1 } },
    );
    if (cached) {
      const timestamp = now();
      await collections.scanJobs.updateOne(
        { workspaceId, _id: scanJobId },
        {
          $set: {
            status: "completed",
            outcome: cached.outcome,
            progress: 100,
            pagesTotal: cached.pagesScanned,
            pagesDone: cached.pagesScanned,
            startedAt: timestamp,
            finishedAt: timestamp,
          },
        },
      );
      await publishEvent(workspaceId, "scan.completed", {
        businessId,
        scanJobId,
        cached: true,
        outcome: cached.outcome,
      });
      return { outcome: cached.outcome };
    }
  }

  await collections.scanJobs.updateOne(
    { workspaceId, _id: scanJobId },
    { $set: { status: "processing", startedAt: now(), progress: 2, pagesTotal: 1 } },
  );

  try {
    const homepageFetch = await fetchPage(business.websiteUrl);
    const pageDetails: PageDetail[] = [];
    let pagesDone = 0;

    if (homepageFetch.failure || !homepageFetch.body) {
      const outcome = (homepageFetch.failure ?? "error") as ScanOutcome;
      pageDetails.push({
        url: homepageFetch.finalUrl,
        outcome,
        httpStatus: homepageFetch.status,
        title: null,
        chatWidgets: [],
        error: homepageFetch.error,
        durationMs: homepageFetch.durationMs,
      });
      await finishFailure(workspaceId, businessId, scanJobId, outcome, pageDetails, started);
      return { outcome };
    }

    pagesDone++;
    const homepage = extractPage(homepageFetch.body, homepageFetch.finalUrl, business.country);
    pageDetails.push({
      url: homepageFetch.finalUrl,
      outcome: "success",
      httpStatus: homepageFetch.status,
      title: homepage.title,
      chatWidgets: homepage.chatWidgets,
      error: null,
      durationMs: homepageFetch.durationMs,
    });
    const extraPages = choosePages(homepageFetch.finalUrl, homepage);
    const pagesTotal = 1 + extraPages.length;
    await collections.scanJobs.updateOne(
      { workspaceId, _id: scanJobId },
      { $set: { pagesTotal, pagesDone, progress: Math.floor((pagesDone / pagesTotal) * 100) } },
    );
    await publishEvent(workspaceId, "scan.progress", {
      businessId,
      scanJobId,
      pagesDone,
      pagesTotal,
    });

    const extraExtractions: PageExtraction[] = [];
    let pageFailures = 0;
    for (const pageUrl of extraPages) {
      const state = await collections.scanJobs.findOne(
        { workspaceId, _id: scanJobId },
        { projection: { _id: 1, cancelRequested: 1 } },
      );
      if (state?.cancelRequested) {
        await collections.scanJobs.updateOne(
          { workspaceId, _id: scanJobId },
          { $set: { status: "cancelled", outcome: "cancelled", finishedAt: now() } },
        );
        await publishEvent(workspaceId, "job.cancelled", { businessId, scanJobId });
        return { outcome: "cancelled" };
      }

      const page = await fetchPage(pageUrl);
      pagesDone++;
      if (page.failure || !page.body) {
        pageFailures++;
        pageDetails.push({
          url: page.finalUrl,
          outcome: page.failure ?? "error",
          httpStatus: page.status,
          title: null,
          chatWidgets: [],
          error: page.error,
          durationMs: page.durationMs,
        });
      } else {
        const extraction = extractPage(page.body, page.finalUrl, business.country);
        extraExtractions.push(extraction);
        pageDetails.push({
          url: page.finalUrl,
          outcome: "success",
          httpStatus: page.status,
          title: extraction.title,
          chatWidgets: extraction.chatWidgets,
          error: null,
          durationMs: page.durationMs,
        });
      }
      await collections.scanJobs.updateOne(
        { workspaceId, _id: scanJobId },
        { $set: { pagesDone, progress: Math.min(95, Math.floor((pagesDone / pagesTotal) * 100)) } },
      );
      await publishEvent(workspaceId, "scan.progress", {
        businessId,
        scanJobId,
        pagesDone,
        pagesTotal,
      });
    }

    const extractions = [homepage, ...extraExtractions];
    const outcome: ScanOutcome = pageFailures > 0 ? "partial" : "success";
    const result = await persistScanResult({
      workspaceId,
      business,
      scanJobId,
      outcome,
      extractions,
      pageDetails,
      started,
    });

    await collections.scanJobs.updateOne(
      { workspaceId, _id: scanJobId },
      {
        $set: {
          status: "completed",
          outcome,
          progress: 100,
          pagesTotal,
          pagesDone,
          finishedAt: now(),
        },
      },
    );

    await collections.activities.insertOne({
      _id: newId(),
      workspaceId,
      businessId,
      type: "scan_completed",
      message:
        outcome === "success"
          ? `Website checked: ${result.chatbotResult === "detected" ? "chat widget detected" : "no chat widget in checked pages"}`
          : "Website check incomplete",
      metadata: { scanJobId, outcome, pages: pageDetails.length, chatbotResult: result.chatbotResult },
      actorId: job.requestedBy,
      createdAt: now(),
    });

    await publishEvent(workspaceId, "scan.completed", {
      businessId,
      scanJobId,
      outcome,
      chatbotResult: result.chatbotResult,
      pages: pageDetails.length,
    });
    return { outcome };
  } catch (error) {
    logger.error({ err: error, businessId, scanJobId }, "Scan failed");
    const message = error instanceof Error ? error.message : "The scan failed.";
    await failJob(workspaceId, scanJobId, message);
    return { outcome: "error" };
  }
}

async function finishFailure(
  workspaceId: string,
  businessId: string,
  scanJobId: string,
  outcome: ScanOutcome,
  pages: PageDetail[],
  started: number,
): Promise<void> {
  const timestamp = now();
  const result: ScanResultDoc = {
    _id: newId(),
    workspaceId,
    businessId,
    jobId: scanJobId,
    outcome,
    chatbotResult: "unknown",
    chatWidgets: [],
    platform: null,
    platformConfidence: null,
    title: null,
    lang: null,
    httpStatus: pages[0]?.httpStatus ?? null,
    finalUrl: pages[0]?.url ?? null,
    pagesScanned: 0,
    pagesSkipped: pages.length,
    confidence: "low",
    pageDetails: pages,
    summary: { pages },
    durationMs: Date.now() - started,
    createdAt: timestamp,
  };
  await collections.scanResults.insertOne(result);

  await collections.businesses.updateOne(
    { workspaceId, _id: businessId },
    {
      $set: {
        latestScanId: result._id,
        latestScanOutcome: outcome,
        latestChatbotResult: "unknown",
        lastCheckedAt: timestamp,
        updatedAt: timestamp,
      },
    },
  );

  await collections.scanJobs.updateOne(
    { workspaceId, _id: scanJobId },
    {
      $set: {
        status: "completed",
        outcome,
        progress: 100,
        pagesTotal: pages.length,
        pagesDone: pages.length,
        finishedAt: timestamp,
      },
    },
  );

  await recalculateLeadScore(workspaceId, businessId);
  await publishEvent(workspaceId, "scan.failed", {
    businessId,
    scanJobId,
    outcome,
    message: pages[0]?.error ?? "The website could not be checked.",
  });
}

interface PersistOptions {
  workspaceId: string;
  business: Pick<BusinessDoc, "_id" | "name" | "country" | "email" | "phoneE164" | "ownerId">;
  scanJobId: string;
  outcome: ScanOutcome;
  extractions: PageExtraction[];
  pageDetails: PageDetail[];
  started: number;
}

async function persistScanResult(options: PersistOptions): Promise<{
  id: string;
  chatbotResult: "detected" | "not_detected" | "unknown";
}> {
  const { workspaceId, business, scanJobId, outcome, extractions, pageDetails } = options;
  const widgets = new Map<string, { name: string; evidence: string; confidence: string; pageUrl: string }>();
  for (const page of extractions) {
    for (const widget of page.chatWidgets) {
      const existing = widgets.get(widget.name);
      if (!existing || (widget.confidence === "high" && existing.confidence !== "high")) {
        widgets.set(widget.name, { ...widget, pageUrl: page.url });
      }
    }
  }
  const chatWidgets = [...widgets.values()];
  const chatbotResult: "detected" | "not_detected" | "unknown" =
    chatWidgets.length > 0 ? "detected" : outcome === "success" ? "not_detected" : "unknown";

  const platformCounts = new Map<string, number>();
  for (const page of extractions) {
    if (page.platform) platformCounts.set(page.platform, (platformCounts.get(page.platform) ?? 0) + 1);
  }
  const platformEntry = [...platformCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const homepage = extractions[0];

  const summary: ScanSummary = {
    generator: homepage?.generator ?? null,
    booking: extractions.some((page) => page.hasBooking),
    inquiryForm: extractions.some((page) => page.hasInquiryForm),
    contactForm: extractions.some((page) => page.hasContactForm),
    emails: [...new Set(extractions.flatMap((page) => page.emails.map((email) => email.value)))],
    phones: [...new Set(extractions.flatMap((page) => page.phones.map((phone) => phone.e164 ?? phone.raw)))],
    whatsapps: [...new Set(extractions.flatMap((page) => page.whatsapps.map((item) => item.e164 ?? item.value)))],
    socials: dedupeSocials(extractions.flatMap((page) => page.socials)),
    pages: pageDetails,
  };

  const confidence: "high" | "medium" | "low" =
    outcome === "success" ? (pageDetails.filter((page) => page.outcome === "success").length >= 2 ? "high" : "medium") : "low";

  const timestamp = now();
  const result: ScanResultDoc = {
    _id: newId(),
    workspaceId,
    businessId: business._id,
    jobId: scanJobId,
    outcome,
    chatbotResult,
    chatWidgets,
    platform: platformEntry?.[0] ?? null,
    platformConfidence: platformEntry ? (platformEntry[1] > 1 ? "high" : "medium") : null,
    title: homepage?.title ?? null,
    lang: homepage?.lang ?? null,
    httpStatus: pageDetails[0]?.httpStatus ?? null,
    finalUrl: homepage?.url ?? null,
    pagesScanned: pageDetails.filter((page) => page.outcome === "success").length,
    pagesSkipped: pageDetails.filter((page) => page.outcome !== "success").length,
    confidence,
    pageDetails,
    summary: summary as unknown as Record<string, unknown>,
    durationMs: Date.now() - options.started,
    createdAt: timestamp,
  };
  await collections.scanResults.insertOne(result);

  await persistContacts(options, chatWidgets, result._id);

  const updates: Partial<BusinessDoc> = {
    latestScanId: result._id,
    latestScanOutcome: outcome,
    latestChatbotResult: chatbotResult,
    lastCheckedAt: timestamp,
    updatedAt: timestamp,
    ...(business.email ? {} : emailForBusiness(summary)),
    ...(business.phoneE164 ? {} : phoneForBusiness(summary)),
  };
  if (summary.whatsapps.length) updates.hasWhatsapp = true;

  await collections.businesses.updateOne(
    { workspaceId, _id: business._id, mergedIntoId: null },
    { $set: updates },
  );

  await recalculateLeadScore(workspaceId, business._id);
  return { id: result._id, chatbotResult };
}

function emailForBusiness(summary: ScanSummary): { email?: string; emailNormalized?: string } {
  const email = summary.emails[0];
  return email ? { email, emailNormalized: email } : {};
}

function phoneForBusiness(summary: ScanSummary): { phone?: string; phoneE164?: string } {
  const phone = summary.phones.find((value) => value.startsWith("+"));
  return phone ? { phone, phoneE164: phone } : {};
}

function dedupeSocials(socials: Array<{ platform: string; url: string }>): Array<{ platform: string; url: string }> {
  const seen = new Set<string>();
  const result: Array<{ platform: string; url: string }> = [];
  for (const social of socials) {
    const key = `${social.platform}:${normaliseUrlForKey(social.url)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(social);
  }
  return result;
}

interface ContactCandidate {
  type: "email" | "phone" | "whatsapp" | "social" | "contact_form" | "booking";
  value: string;
  normalizedValue: string;
  label: string | null;
  platform: string | null;
  confidence: "high" | "medium" | "low";
  evidence: Array<{ originalValue: string; sourceUrl: string; method: string; confidence: "high" | "medium" | "low" }>;
}

async function persistContacts(
  options: PersistOptions,
  chatWidgets: Array<{ name: string; pageUrl: string }>,
  scanResultId: string,
): Promise<void> {
  const { workspaceId, business } = options;
  const candidates = new Map<string, ContactCandidate>();
  const add = (candidate: ContactCandidate): void => {
    const key = `${candidate.type}:${candidate.normalizedValue}`;
    const existing = candidates.get(key);
    if (existing) {
      existing.evidence.push(...candidate.evidence);
      return;
    }
    candidates.set(key, candidate);
  };

  for (const page of options.extractions) {
    for (const email of page.emails) {
      add({
        type: "email",
        value: email.value,
        normalizedValue: email.value,
        label: null,
        platform: null,
        confidence: email.source === "mailto" ? "high" : "medium",
        evidence: [{ originalValue: email.value, sourceUrl: page.url, method: email.source, confidence: email.source === "mailto" ? "high" : "medium" }],
      });
    }
    for (const phone of page.phones) {
      const normalized = phone.e164 ?? phone.raw.replace(/[^\d+]/g, "");
      if (!normalized) continue;
      add({
        type: "phone",
        value: phone.raw,
        normalizedValue: normalized,
        label: phone.kind,
        platform: null,
        confidence: phone.e164 ? "high" : "low",
        evidence: [{ originalValue: phone.raw, sourceUrl: page.url, method: "tel-link", confidence: phone.e164 ? "high" : "low" }],
      });
    }
    for (const whatsapp of page.whatsapps) {
      add({
        type: "whatsapp",
        value: whatsapp.value,
        normalizedValue: whatsapp.e164 ?? normaliseUrlForKey(whatsapp.value),
        label: whatsapp.e164 ? "WhatsApp link" : "WhatsApp link (number unknown)",
        platform: "WhatsApp",
        confidence: whatsapp.e164 ? "high" : "medium",
        evidence: [{ originalValue: whatsapp.value, sourceUrl: page.url, method: "explicit-link", confidence: whatsapp.e164 ? "high" : "medium" }],
      });
    }
    for (const social of page.socials) {
      add({
        type: "social",
        value: social.url,
        normalizedValue: normaliseUrlForKey(social.url),
        label: social.platform,
        platform: social.platform,
        confidence: "medium",
        evidence: [{ originalValue: social.url, sourceUrl: page.url, method: "public-link", confidence: "medium" }],
      });
    }
    if (page.hasContactForm) {
      add({
        type: "contact_form",
        value: page.url,
        normalizedValue: normaliseUrlForKey(page.url),
        label: "Contact form",
        platform: null,
        confidence: "medium",
        evidence: [{ originalValue: page.url, sourceUrl: page.url, method: "form", confidence: "medium" }],
      });
    }
    if (page.hasBooking) {
      add({
        type: "booking",
        value: page.url,
        normalizedValue: normaliseUrlForKey(page.url),
        label: "Booking / appointment link",
        platform: null,
        confidence: "medium",
        evidence: [{ originalValue: page.url, sourceUrl: page.url, method: "booking-link", confidence: "medium" }],
      });
    }
  }

  if (chatWidgets.length) {
    const first = chatWidgets[0];
    if (first) {
      add({
        type: "contact_form",
        value: first.pageUrl,
        normalizedValue: `chat-widget:${chatWidgets.map((widget) => widget.name).sort().join("|")}`,
        label: `Chat widget: ${chatWidgets.map((widget) => widget.name).join(", ")}`,
        platform: chatWidgets[0]?.name ?? null,
        confidence: "medium",
        evidence: chatWidgets.map((widget) => ({
          originalValue: widget.name,
          sourceUrl: widget.pageUrl,
          method: "chat-widget",
          confidence: "medium" as const,
        })),
      });
    }
  }

  const timestamp = now();
  for (const candidate of candidates.values()) {
    const value = candidate.value.slice(0, 2000);
    const normalizedValue = candidate.normalizedValue.slice(0, 2000);
    const existing = await collections.contactPoints.findOne({
      businessId: business._id,
      type: candidate.type,
      normalizedValue,
    });

    let contactId: string;
    if (existing) {
      contactId = existing._id;
      await collections.contactPoints.updateOne(
        { _id: existing._id },
        {
          $set: {
            lastSeenAt: timestamp,
            label: candidate.label,
            platform: candidate.platform,
          },
        },
      );
    } else {
      contactId = newId();
      await collections.contactPoints.insertOne({
        _id: contactId,
        workspaceId,
        businessId: business._id,
        type: candidate.type,
        value,
        normalizedValue,
        label: candidate.label,
        platform: candidate.platform,
        verifiedByUser: false,
        confidence: candidate.confidence,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        createdAt: timestamp,
      });
    }

    for (const evidence of candidate.evidence.slice(0, 8)) {
      const originalValue = evidence.originalValue.slice(0, 1000);
      const sourceUrl = evidence.sourceUrl.slice(0, 2000);
      await collections.evidenceRecords.updateOne(
        {
          businessId: business._id,
          type: candidate.type,
          originalValue,
          sourceUrl,
        },
        {
          $setOnInsert: {
            _id: newId(),
            workspaceId,
            businessId: business._id,
            contactPointId: contactId,
            scanResultId,
            type: candidate.type,
            originalValue,
            normalizedValue: candidate.normalizedValue.slice(0, 1000),
            sourceUrl,
            method: evidence.method,
            confidence: evidence.confidence,
            verificationStatus: "unverified",
            firstSeenAt: timestamp,
            lastSeenAt: timestamp,
          },
        },
        { upsert: true },
      );
    }
  }
}

async function failJob(workspaceId: string, scanJobId: string, message: string): Promise<void> {
  await collections.scanJobs.updateOne(
    { workspaceId, _id: scanJobId },
    {
      $set: {
        status: "failed",
        outcome: "error",
        error: message.slice(0, 2000),
        progress: 100,
        finishedAt: now(),
      },
    },
  );
  await publishEvent(workspaceId, "scan.failed", { scanJobId, message });
}

/** Exported for tests. */
export function orderScanPages(baseUrl: string, homepage: PageExtraction): string[] {
  return choosePages(baseUrl, homepage);
}
