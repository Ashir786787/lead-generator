import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { db, pool } from "@/lib/db";
import {
  account,
  activities,
  businessTags,
  businesses,
  contactPoints,
  duplicateCandidates,
  evidenceRecords,
  importJobs,
  memberships,
  notes,
  savedSearches,
  savedViews,
  scanJobs,
  scanResults,
  scoreProfiles,
  scoreResults,
  sourceRecords,
  tags,
  user,
  workspaces,
} from "@/lib/db/schema";
import { PROFILE_NAME } from "@/lib/score/service";
import { cloneDefaultConfig } from "@/lib/score/config";
import { computeScore } from "@/lib/score/engine";
import { normalizeBusiness } from "@/lib/normalize";
import type { PipelineStatus } from "@/lib/constants";
import type { Database } from "@/lib/db";

export const DEMO_EMAIL = "demo@leadfinder.example";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";
export const DEMO_WORKSPACE_SLUG = "demo-fictional";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

interface DemoContactSeed {
  type: "email" | "phone" | "whatsapp" | "contact_form" | "social";
  value: string;
  normalized: string;
  label?: string;
  platform?: string;
}

interface DemoLeadSeed {
  sourceId: string;
  name: string;
  category: string;
  city: string;
  street: string;
  lat: number;
  lng: number;
  website?: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  social?: string;
  status: PipelineStatus;
  notes?: string;
  tags?: string[];
  followUpDays?: number;
  hasBooking?: boolean;
  hasInquiryForm?: boolean;
  hasContactForm?: boolean;
  scan:
    | null
    | {
        outcome: "success" | "partial";
        chatbot: "detected" | "not_detected" | "unknown";
        widgets?: Array<{ name: string; evidence: string; confidence: "high" | "medium" }>;
        platform?: string;
        title?: string;
        pages?: number;
        confidence?: "high" | "medium" | "low";
      };
}

const DEMO_LEADS: DemoLeadSeed[] = [
  {
    sourceId: "demo-001",
    name: "Marina Smile Studio",
    category: "Dentist",
    city: "Dubai",
    street: "12 Marina Walk",
    lat: 25.0805,
    lng: 55.1403,
    website: "https://marinasmile.example",
    email: "hello@marinasmile.example",
    phone: "+971 4 555 0101",
    whatsapp: "+971 50 555 0101",
    social: "https://www.instagram.com/marinasmile.example",
    status: "qualified",
    notes: "Owner asked for a callback after 4pm. Prefers WhatsApp for scheduling.",
    tags: ["High priority", "Warm"],
    followUpDays: 2,
    hasBooking: true,
    hasInquiryForm: true,
    hasContactForm: true,
    scan: {
      outcome: "success",
      chatbot: "not_detected",
      platform: "WordPress",
      title: "Marina Smile Studio — Dentists in Dubai Marina",
      pages: 4,
      confidence: "high",
    },
  },
  {
    sourceId: "demo-002",
    name: "Marina Smile Dental Care",
    category: "Dentist",
    city: "Dubai",
    street: "12 Marina Walk",
    lat: 25.0806,
    lng: 55.1404,
    website: "https://www.marinasmile.example",
    email: "reception@marinasmile.example",
    phone: "+971 4 555 0101",
    status: "new",
    notes: "Possible duplicate of Marina Smile Studio — same address and phone.",
    scan: {
      outcome: "success",
      chatbot: "not_detected",
      platform: "WordPress",
      title: "Marina Smile Dental Care",
      pages: 2,
      confidence: "medium",
    },
  },
  {
    sourceId: "demo-003",
    name: "Ghaf Coffee House",
    category: "Cafe",
    city: "Dubai",
    street: "Unit 4, Ghaf Avenue, Al Quoz",
    lat: 25.1372,
    lng: 55.2267,
    website: "https://ghafcoffee.example",
    email: "hello@ghafcoffee.example",
    phone: "+971 4 555 0102",
    social: "https://www.instagram.com/ghafcoffee.example",
    status: "reviewing",
    notes: "Runs a live chat widget, so the no-chatbot angle is weaker here.",
    hasInquiryForm: true,
    hasContactForm: true,
    scan: {
      outcome: "success",
      chatbot: "detected",
      widgets: [
        {
          name: "Intercom",
          evidence: "Loaded from widget.intercom.io",
          confidence: "high",
        },
      ],
      platform: "Shopify",
      title: "Ghaf Coffee House",
      pages: 3,
      confidence: "high",
    },
  },
  {
    sourceId: "demo-004",
    name: "Saffron Table",
    category: "Restaurant",
    city: "Dubai",
    street: "Pier 7, Dubai Marina",
    lat: 25.0786,
    lng: 55.1339,
    website: "https://saffrontable.example",
    email: "bookings@saffrontable.example",
    phone: "+971 4 555 0103",
    status: "contacted",
    notes: "Reservation widget already present; pitch is an inquiry follow-up assistant.",
    hasBooking: true,
    hasContactForm: true,
    scan: {
      outcome: "success",
      chatbot: "not_detected",
      platform: "Squarespace",
      title: "Saffron Table — Modern Gulf Kitchen",
      pages: 5,
      confidence: "high",
    },
  },
  {
    sourceId: "demo-005",
    name: "Al Reem Physiotherapy",
    category: "Clinic",
    city: "Sharjah",
    street: "Al Reem Plaza, King Faisal Street",
    lat: 25.3463,
    lng: 55.4209,
    phone: "+971 6 555 0104",
    status: "new",
    notes: "No website found yet. Contact by phone before proposing anything.",
    scan: null,
  },
  {
    sourceId: "demo-006",
    name: "Northline Accounting",
    category: "Accounting",
    city: "Dubai",
    street: "Office 902, Business Bay",
    lat: 25.1857,
    lng: 55.2769,
    website: "https://northline.example",
    email: "enquiries@northline.example",
    phone: "+971 4 555 0105",
    status: "follow_up",
    notes: "Scan only completed the home page. Re-run once the site responds faster.",
    followUpDays: 5,
    hasContactForm: true,
    scan: {
      outcome: "partial",
      chatbot: "unknown",
      platform: "Wix",
      title: "Northline Accounting",
      pages: 1,
      confidence: "low",
    },
  },
  {
    sourceId: "demo-007",
    name: "Cedar & Salt Spa",
    category: "Spa",
    city: "Abu Dhabi",
    street: "Corniche Road",
    lat: 24.4764,
    lng: 54.3705,
    website: "https://cedarsalt.example",
    email: "care@cedarsalt.example",
    phone: "+971 2 555 0106",
    whatsapp: "+971 50 555 0106",
    status: "won",
    notes: "Signed a pilot. Keep the workspace record as a reference implementation.",
    tags: ["Warm"],
    hasBooking: true,
    hasInquiryForm: true,
    hasContactForm: true,
    scan: {
      outcome: "success",
      chatbot: "not_detected",
      platform: "Webflow",
      title: "Cedar & Salt Spa",
      pages: 4,
      confidence: "high",
    },
  },
  {
    sourceId: "demo-008",
    name: "Harbour Lane Legal",
    category: "Law firm",
    city: "Dubai",
    street: "Gate Village 3, DIFC",
    lat: 25.2121,
    lng: 55.2818,
    website: "https://harbourlane.example",
    email: "intake@harbourlane.example",
    status: "do_not_contact",
    notes: "Asked not to be contacted again. Kept for suppression awareness only.",
    scan: null,
  },
];

function contactsFor(lead: DemoLeadSeed): DemoContactSeed[] {
  const contacts: DemoContactSeed[] = [];
  if (lead.email) contacts.push({ type: "email", value: lead.email, normalized: lead.email });
  if (lead.phone) {
    contacts.push({
      type: "phone",
      value: lead.phone,
      normalized: lead.phone.replace(/[^\d+]/g, ""),
      label: "fixed_line",
    });
  }
  if (lead.whatsapp) {
    const normalized = lead.whatsapp.replace(/[^\d+]/g, "");
    contacts.push({
      type: "whatsapp",
      value: `https://wa.me/${normalized.replace(/\D/g, "")}`,
      normalized,
      platform: "WhatsApp",
    });
  }
  if (lead.hasContactForm && lead.website) {
    contacts.push({
      type: "contact_form",
      value: `${lead.website}/contact`,
      normalized: `${lead.website}/contact`,
      label: "Contact form",
    });
  }
  if (lead.social) {
    contacts.push({
      type: "social",
      value: lead.social,
      normalized: lead.social,
      platform: "Instagram",
    });
  }
  return contacts;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function ensureDemoUser(): Promise<string> {
  const [existing] = await db.select().from(user).where(eq(user.email, DEMO_EMAIL)).limit(1);
  const password = await hashPassword(DEMO_PASSWORD);

  if (existing) {
    await db.update(user).set({ name: "Demo Owner", emailVerified: true }).where(eq(user.id, existing.id));
    const [credential] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, existing.id), eq(account.providerId, "credential")))
      .limit(1);
    if (credential) {
      await db.update(account).set({ password }).where(eq(account.id, credential.id));
    } else {
      await db.insert(account).values({
        id: randomUUID(),
        accountId: existing.id,
        providerId: "credential",
        userId: existing.id,
        password,
      });
    }
    return existing.id;
  }

  const userId = randomUUID();
  await db.insert(user).values({
    id: userId,
    name: "Demo Owner",
    email: DEMO_EMAIL,
    emailVerified: true,
  });
  await db.insert(account).values({
    id: randomUUID(),
    accountId: userId,
    providerId: "credential",
    userId,
    password,
  });
  return userId;
}

async function seedWithin(tx: Transaction, userId: string): Promise<{ workspaceId: string; leadCount: number }> {
  const [workspace] = await tx
    .insert(workspaces)
    .values({
      name: "Demo (fictional)",
      slug: DEMO_WORKSPACE_SLUG,
      isDemo: true,
      timezone: "UTC",
      countryNotes: {},
    })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error("Could not create the demo workspace.");

  await tx.insert(memberships).values({
    workspaceId: workspace.id,
    userId,
    role: "owner",
  });

  // Created inline (rather than via ensureDefaultProfile) because that helper
  // uses the shared client, which cannot see rows from this open transaction.
  const [profile] = await tx
    .insert(scoreProfiles)
    .values({
      workspaceId: workspace.id,
      name: PROFILE_NAME,
      version: 1,
      isActive: true,
      config: cloneDefaultConfig(),
      createdBy: userId,
    })
    .returning();
  if (!profile) throw new Error("Could not create the demo score profile.");

  const [importJob] = await tx
    .insert(importJobs)
    .values({
      workspaceId: workspace.id,
      createdBy: userId,
      origin: "import",
      filename: "demo-fictional-businesses.csv",
      fileHash: "demo-fictional-file-hash",
      mappingHash: "demo-fictional-mapping-hash",
      idempotencyKey: "demo-import-v1",
      storagePath: null,
      mapping: {
        name: "Business Name",
        category: "Category",
        website: "Website",
        phone: "Phone",
        email: "Email",
        street: "Street",
        city: "City",
      },
      detectedColumns: ["Business Name", "Category", "Website", "Phone", "Email", "Street", "City"],
      status: "completed",
      progress: 100,
      processedRows: DEMO_LEADS.length,
      rowCount: DEMO_LEADS.length,
      validCount: DEMO_LEADS.length,
      newCount: DEMO_LEADS.length - 1,
      duplicateCount: 1,
      reviewCount: 1,
      mappingConfirmed: true,
      startedAt: daysAgo(9),
      finishedAt: daysAgo(9),
    })
    .returning({ id: importJobs.id });

  const tagNames: Array<{ name: string; color: string }> = [
    { name: "High priority", color: "warning" },
    { name: "Warm", color: "success" },
    { name: "Needs follow-up", color: "primary" },
  ];
  const tagRows = await tx
    .insert(tags)
    .values(tagNames.map((tag) => ({ ...tag, workspaceId: workspace.id })))
    .returning({ id: tags.id, name: tags.name });
  const tagByName = new Map(tagRows.map((tag) => [tag.name, tag.id]));

  const leadIds: string[] = [];
  const leadIdBySource = new Map<string, string>();

  for (const [index, lead] of DEMO_LEADS.entries()) {
    const normalized = normalizeBusiness({
      name: lead.name,
      category: lead.category,
      website: lead.website,
      phone: lead.phone,
      email: lead.email,
      street: lead.street,
      city: lead.city,
      country: "United Arab Emirates",
      lat: lead.lat,
      lng: lead.lng,
      sourceId: lead.sourceId,
    });
    const contacts = contactsFor(lead);
    const score = computeScore(
      {
        categoryKey: normalized.categoryKey,
        scan: lead.scan
          ? {
              outcome: lead.scan.outcome,
              chatbotResult: lead.scan.chatbot,
              chatWidgets: lead.scan.widgets ?? [],
              summary: null,
            }
          : null,
        contacts: contacts.map((contact) => ({
          type: contact.type,
          normalizedValue: contact.normalized,
        })),
        hasExplicitWhatsapp: Boolean(lead.whatsapp),
        hasBooking: Boolean(lead.hasBooking),
        hasInquiryForm: Boolean(lead.hasInquiryForm),
      },
      profile.config,
      { profileId: profile.id, profileVersion: profile.version },
    );

    const [business] = await tx
      .insert(businesses)
      .values({
        workspaceId: workspace.id,
        name: normalized.name,
        normalizedName: normalized.normalizedName,
        category: normalized.category,
        categoryKey: normalized.categoryKey,
        phone: normalized.phone?.raw ?? lead.phone ?? null,
        phoneE164: normalized.phone?.e164 ?? null,
        email: normalized.emailDisplay,
        emailNormalized: normalized.email,
        websiteUrl: normalized.website?.url ?? null,
        websiteHost: normalized.website?.host ?? null,
        street: normalized.street,
        area: normalized.area,
        city: normalized.city,
        country: normalized.country,
        lat: normalized.lat,
        lng: normalized.lng,
        status: lead.status,
        ownerId: userId,
        doNotContact: lead.status === "do_not_contact",
        followUpAt: lead.followUpDays !== undefined ? daysFromNow(lead.followUpDays) : null,
        notes: lead.notes ?? null,
        fieldLocks: [],
        isDemo: true,
        latestScore: score.total,
        lastCheckedAt: lead.scan ? daysAgo(index + 1) : null,
        createdAt: daysAgo(10 - index),
        updatedAt: daysAgo(index),
      })
      .returning({ id: businesses.id });
    if (!business) throw new Error(`Could not create demo lead ${lead.name}.`);
    leadIds.push(business.id);
    leadIdBySource.set(lead.sourceId, business.id);

    await tx.insert(sourceRecords).values({
      workspaceId: workspace.id,
      businessId: business.id,
      source: "demo",
      sourceId: lead.sourceId,
      payload: { fictional: true, name: lead.name },
      attribution: "Demo data (fictional) — not a real business",
      importJobId: importJob?.id ?? null,
    });

    const contactRows = contacts.length
      ? await tx
          .insert(contactPoints)
          .values(
            contacts.map((contact) => ({
              workspaceId: workspace.id,
              businessId: business.id,
              type: contact.type,
              value: contact.value,
              normalizedValue: contact.normalized,
              label: contact.label ?? null,
              platform: contact.platform ?? null,
              confidence: "medium" as const,
            })),
          )
          .returning({ id: contactPoints.id, type: contactPoints.type, value: contactPoints.value })
      : [];

    if (contactRows.length) {
      const sourceUrl = lead.website ?? "https://demo.leadfinder.example/source";
      await tx.insert(evidenceRecords).values(
        contactRows.map((contact) => ({
          workspaceId: workspace.id,
          businessId: business.id,
          contactPointId: contact.id,
          type: contact.type,
          originalValue: contact.value,
          normalizedValue: contacts.find((entry) => entry.value === contact.value)?.normalized ?? null,
          sourceUrl,
          method: lead.scan ? "website_scan" : "import",
          confidence: "medium" as const,
          verificationStatus: "unverified",
        })),
      );
    }

    const [scoreRow] = await tx
      .insert(scoreResults)
      .values({
        workspaceId: workspace.id,
        businessId: business.id,
        profileId: profile.id,
        profileVersion: profile.version,
        total: score.total,
        components: score.components,
        calculatedAt: daysAgo(index),
      })
      .returning({ id: scoreResults.id });

    let scanResultId: string | null = null;
    if (lead.scan) {
      const [scanJob] = await tx
        .insert(scanJobs)
        .values({
          workspaceId: workspace.id,
          businessId: business.id,
          requestedBy: userId,
          status: "completed",
          outcome: lead.scan.outcome,
          progress: 100,
          pagesTotal: lead.scan.pages ?? 1,
          pagesDone: lead.scan.pages ?? 1,
          force: false,
          createdAt: daysAgo(index + 1),
          startedAt: daysAgo(index + 1),
          finishedAt: daysAgo(index + 1),
        })
        .returning({ id: scanJobs.id });

      const [scanRow] = await tx
        .insert(scanResults)
        .values({
          workspaceId: workspace.id,
          businessId: business.id,
          jobId: scanJob?.id ?? null,
          outcome: lead.scan.outcome,
          chatbotResult: lead.scan.chatbot,
          chatWidgets: lead.scan.widgets ?? [],
          platform: lead.scan.platform ?? null,
          platformConfidence: lead.scan.platform ? "medium" : null,
          title: lead.scan.title ?? null,
          lang: "en",
          httpStatus: 200,
          finalUrl: lead.website ?? null,
          pagesScanned: lead.scan.outcome === "success" ? (lead.scan.pages ?? 1) : 1,
          pagesSkipped: lead.scan.outcome === "partial" ? Math.max(0, (lead.scan.pages ?? 1) - 1) : 0,
          confidence: lead.scan.confidence ?? "medium",
          pageDetails: [
            {
              url: lead.website ?? null,
              outcome: lead.scan.outcome === "success" ? "success" : "partial",
              status: 200,
            },
          ],
          summary: {
            note:
              lead.scan.outcome === "success"
                ? "Demo scan result. Pages were checked for contact details and chat widgets."
                : "Demo scan stopped after the home page; remaining points were withheld.",
          },
          durationMs: 1200 + index * 130,
          createdAt: daysAgo(index + 1),
        })
        .returning({ id: scanResults.id });
      scanResultId = scanRow?.id ?? null;

      await tx
        .update(businesses)
        .set({
          latestScore: score.total,
          latestScoreResultId: scoreRow?.id ?? null,
          latestScanId: scanResultId,
          latestScanOutcome: lead.scan.outcome,
          latestChatbotResult: lead.scan.chatbot,
          lastCheckedAt: daysAgo(index + 1),
        })
        .where(and(eq(businesses.workspaceId, workspace.id), eq(businesses.id, business.id)));

      await tx.insert(activities).values({
        workspaceId: workspace.id,
        businessId: business.id,
        type: "scan_completed",
        message:
          lead.scan.outcome === "success"
            ? `Website check completed (${lead.scan.pages ?? 1} pages).`
            : "Website check partially completed; scan-dependent points were withheld.",
        metadata: { outcome: lead.scan.outcome, chatbot: lead.scan.chatbot },
        actorId: userId,
        createdAt: daysAgo(index + 1),
      });
    } else {
      await tx
        .update(businesses)
        .set({ latestScoreResultId: scoreRow?.id ?? null })
        .where(and(eq(businesses.workspaceId, workspace.id), eq(businesses.id, business.id)));
    }

    await tx.insert(activities).values([
      {
        workspaceId: workspace.id,
        businessId: business.id,
        type: "imported",
        message: "Imported from demo-fictional-businesses.csv",
        actorId: userId,
        createdAt: daysAgo(9),
      },
      {
        workspaceId: workspace.id,
        businessId: business.id,
        type: "status_changed",
        message: `Status set to ${lead.status.replaceAll("_", " ")}.`,
        actorId: userId,
        createdAt: daysAgo(index),
      },
    ]);

    if (lead.notes) {
      await tx.insert(notes).values({
        workspaceId: workspace.id,
        businessId: business.id,
        body: lead.notes,
        authorId: userId,
        createdAt: daysAgo(index),
        updatedAt: daysAgo(index),
      });
    }

    for (const tagName of lead.tags ?? []) {
      const tagId = tagByName.get(tagName);
      if (tagId) {
        await tx.insert(businessTags).values({
          workspaceId: workspace.id,
          businessId: business.id,
          tagId,
        });
      }
    }
  }

  const primaryId = leadIdBySource.get("demo-001");
  const duplicateId = leadIdBySource.get("demo-002");
  if (primaryId && duplicateId) {
    await tx.insert(duplicateCandidates).values({
      workspaceId: workspace.id,
      businessAId: primaryId,
      businessBId: duplicateId,
      similarity: 0.94,
      distanceM: 12,
      reasons: [
        "Same phone number and very similar name",
        "Same website domain",
        "Same street address",
      ],
      status: "pending",
    });
  }

  const demoViewQuery: Record<string, string> = {
    minScore: "70",
    sort: "score_desc",
    includeArchived: "false",
  };
  await tx.insert(savedViews).values({
    workspaceId: workspace.id,
    userId,
    name: "High-score leads",
    query: demoViewQuery,
  });

  await tx.insert(savedSearches).values({
    workspaceId: workspace.id,
    provider: "osm",
    country: "United Arab Emirates",
    city: "Dubai",
    categories: ["dentist", "salon"],
    limitCount: 50,
    enabled: false,
  });

  await tx.insert(activities).values({
    workspaceId: workspace.id,
    businessId: null,
    type: "imported",
    message: `Demo import completed with ${DEMO_LEADS.length} fictional businesses.`,
    actorId: userId,
    createdAt: daysAgo(9),
  });

  return { workspaceId: workspace.id, leadCount: leadIds.length };
}

async function main(): Promise<void> {
  const userId = await ensureDemoUser();

  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(and(eq(workspaces.slug, DEMO_WORKSPACE_SLUG), eq(workspaces.isDemo, true)))
    .limit(1);
  if (existing) {
    await db.delete(workspaces).where(eq(workspaces.id, existing.id));
  }

  const result = await db.transaction((tx) => seedWithin(tx, userId));

  console.log(
    [
      "Demo workspace ready.",
      `  Email:    ${DEMO_EMAIL}`,
      `  Password: ${DEMO_PASSWORD}`,
      `  Workspace: Demo (fictional) [${result.workspaceId}]`,
      `  Leads:    ${result.leadCount} fictional businesses`,
      `  Profile:  ${PROFILE_NAME}`,
      "All businesses, contacts and scans in this workspace are fictional.",
    ].join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
