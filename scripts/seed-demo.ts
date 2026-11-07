import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { closeMongo, collections, newId, now } from "@/lib/db";
import { ensureIndexes } from "@/lib/db/indexes";
import type {
  AccountDoc,
  ActivityDoc,
  BusinessDoc,
  BusinessLocationDoc,
  BusinessTagDoc,
  ContactPointDoc,
  DuplicateCandidateDoc,
  EvidenceRecordDoc,
  ImportJobDoc,
  MembershipDoc,
  NoteDoc,
  SavedSearchDoc,
  SavedViewDoc,
  ScanJobDoc,
  ScanResultDoc,
  ScoreProfileDoc,
  ScoreResultDoc,
  SourceRecordDoc,
  TagDoc,
  UserDoc,
  WorkspaceDoc,
} from "@/lib/db/types";
import { PROFILE_NAME } from "@/lib/score/service";
import { cloneDefaultConfig } from "@/lib/score/config";
import { computeScore } from "@/lib/score/engine";
import { nameTokens, normalizeBusiness } from "@/lib/normalize";
import type { PipelineStatus } from "@/lib/constants";

export const DEMO_EMAIL = "demo@leadfinder.example";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";
export const DEMO_WORKSPACE_SLUG = "demo-fictional";

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

/** Every collection that carries workspace-scoped demo data. */
const DEMO_SCOPED_COLLECTIONS = [
  collections.businesses,
  collections.businessLocations,
  collections.sourceRecords,
  collections.contactPoints,
  collections.importJobs,
  collections.importRowErrors,
  collections.scanJobs,
  collections.scanResults,
  collections.evidenceRecords,
  collections.scoreProfiles,
  collections.scoreResults,
  collections.notes,
  collections.tags,
  collections.businessTags,
  collections.activities,
  collections.duplicateCandidates,
  collections.mergeHistory,
  collections.savedViews,
  collections.categoryMappings,
  collections.exportJobs,
  collections.savedSearches,
] as const;

async function ensureDemoUser(): Promise<string> {
  const existing = await collections.user.findOne({ email: DEMO_EMAIL });
  const password = await hashPassword(DEMO_PASSWORD);
  const timestamp = now();

  if (existing) {
    await collections.user.updateOne(
      { _id: existing._id },
      { $set: { name: "Demo Owner", emailVerified: true, updatedAt: timestamp } },
    );
    const credential = await collections.account.findOne({
      userId: existing._id,
      providerId: "credential",
    });
    if (credential) {
      await collections.account.updateOne(
        { _id: credential._id },
        { $set: { password, updatedAt: timestamp } },
      );
    } else {
      const account: AccountDoc = {
        _id: newId(),
        accountId: existing._id,
        providerId: "credential",
        userId: existing._id,
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await collections.account.insertOne(account);
    }
    return existing._id;
  }

  const userId = newId();
  const user: UserDoc = {
    _id: userId,
    name: "Demo Owner",
    email: DEMO_EMAIL,
    emailVerified: true,
    image: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await collections.user.insertOne(user);
  const account: AccountDoc = {
    _id: newId(),
    accountId: userId,
    providerId: "credential",
    userId,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    password,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await collections.account.insertOne(account);
  return userId;
}

interface SeedResult {
  workspaceId: string;
  leadCount: number;
}

async function seedWorkspace(userId: string): Promise<SeedResult> {
  const workspace: WorkspaceDoc = {
    _id: newId(),
    name: "Demo (fictional)",
    slug: DEMO_WORKSPACE_SLUG,
    isDemo: true,
    timezone: "UTC",
    countryNotes: {},
    createdAt: daysAgo(10),
    updatedAt: daysAgo(1),
  };
  await collections.workspaces.insertOne(workspace);
  const workspaceId = workspace._id;

  const membership: MembershipDoc = {
    _id: newId(),
    workspaceId,
    userId,
    role: "owner",
    createdAt: workspace.createdAt,
  };
  await collections.memberships.insertOne(membership);

  const profile: ScoreProfileDoc = {
    _id: newId(),
    workspaceId,
    name: PROFILE_NAME,
    version: 1,
    isActive: true,
    config: cloneDefaultConfig(),
    createdAt: workspace.createdAt,
    createdBy: userId,
  };
  await collections.scoreProfiles.insertOne(profile);

  const importJob: ImportJobDoc = {
    _id: newId(),
    workspaceId,
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
    mergedCount: 0,
    reviewCount: 1,
    skippedCount: 0,
    errorCount: 0,
    mappingConfirmed: true,
    error: null,
    createdAt: daysAgo(9),
    startedAt: daysAgo(9),
    finishedAt: daysAgo(9),
  };
  await collections.importJobs.insertOne(importJob);

  const tagDefs: Array<{ name: string; color: string }> = [
    { name: "High priority", color: "warning" },
    { name: "Warm", color: "success" },
    { name: "Needs follow-up", color: "primary" },
  ];
  const tagDocs: TagDoc[] = tagDefs.map((tag) => ({
    _id: newId(),
    workspaceId,
    name: tag.name,
    color: tag.color,
    createdAt: workspace.createdAt,
  }));
  await collections.tags.insertMany(tagDocs);
  const tagByName = new Map(tagDocs.map((tag) => [tag.name, tag._id]));

  const businesses: BusinessDoc[] = [];
  const locations: BusinessLocationDoc[] = [];
  const sources: SourceRecordDoc[] = [];
  const contacts: ContactPointDoc[] = [];
  const evidence: EvidenceRecordDoc[] = [];
  const scoreResults: ScoreResultDoc[] = [];
  const scanJobs: ScanJobDoc[] = [];
  const scanResults: ScanResultDoc[] = [];
  const activities: ActivityDoc[] = [];
  const notes: NoteDoc[] = [];
  const businessTags: BusinessTagDoc[] = [];
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
    const leadContacts = contactsFor(lead);
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
        contacts: leadContacts.map((contact) => ({
          type: contact.type,
          normalizedValue: contact.normalized,
        })),
        hasExplicitWhatsapp: Boolean(lead.whatsapp),
        hasBooking: Boolean(lead.hasBooking),
        hasInquiryForm: Boolean(lead.hasInquiryForm),
      },
      profile.config,
      { profileId: profile._id, profileVersion: profile.version },
    );

    const businessId = newId();
    leadIdBySource.set(lead.sourceId, businessId);
    const scoreResultId = newId();
    const scanJobId = lead.scan ? newId() : null;
    const scanResultId = lead.scan ? newId() : null;
    const createdAt = daysAgo(10 - index);
    const checkedAt = lead.scan ? daysAgo(index + 1) : null;

    businesses.push({
      _id: businessId,
      workspaceId,
      name: normalized.name,
      normalizedName: normalized.normalizedName,
      nameTokens: nameTokens(normalized.normalizedName),
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
      latestScore: score.total,
      latestScoreResultId: scoreResultId,
      latestScanId: scanResultId,
      latestScanOutcome: lead.scan?.outcome ?? null,
      latestChatbotResult: lead.scan?.chatbot ?? null,
      lastCheckedAt: checkedAt,
      isDemo: true,
      hasWhatsapp: Boolean(lead.whatsapp),
      mergedIntoId: null,
      archivedAt: null,
      createdAt,
      updatedAt: daysAgo(index),
    });

    locations.push({
      _id: newId(),
      workspaceId,
      businessId,
      street: normalized.street,
      area: normalized.area,
      city: normalized.city,
      country: normalized.country,
      lat: normalized.lat,
      lng: normalized.lng,
      formattedAddress: null,
      isPrimary: true,
      createdAt,
    });

    sources.push({
      _id: newId(),
      workspaceId,
      businessId,
      source: "demo",
      sourceId: lead.sourceId,
      payload: { fictional: true, name: lead.name },
      attribution: "Demo data (fictional) — not a real business",
      importJobId: importJob._id,
      createdAt,
    });

    const contactDocs: ContactPointDoc[] = leadContacts.map((contact) => ({
      _id: newId(),
      workspaceId,
      businessId,
      type: contact.type,
      value: contact.value,
      normalizedValue: contact.normalized,
      label: contact.label ?? null,
      platform: contact.platform ?? null,
      verifiedByUser: false,
      confidence: "medium",
      firstSeenAt: createdAt,
      lastSeenAt: checkedAt ?? createdAt,
      createdAt,
    }));
    contacts.push(...contactDocs);

    const sourceUrl = lead.website ?? "https://demo.leadfinder.example/source";
    for (const contact of contactDocs) {
      evidence.push({
        _id: newId(),
        workspaceId,
        businessId,
        contactPointId: contact._id,
        scanResultId,
        type: contact.type,
        originalValue: contact.value,
        normalizedValue: contact.normalizedValue,
        sourceUrl,
        method: lead.scan ? "website_scan" : "import",
        confidence: "medium",
        verificationStatus: "unverified",
        firstSeenAt: createdAt,
        lastSeenAt: checkedAt ?? createdAt,
      });
    }

    scoreResults.push({
      _id: scoreResultId,
      workspaceId,
      businessId,
      profileId: profile._id,
      profileVersion: profile.version,
      total: score.total,
      components: score.components,
      calculatedAt: daysAgo(index),
    });

    if (lead.scan) {
      const pages = lead.scan.pages ?? 1;
      scanJobs.push({
        _id: scanJobId!,
        workspaceId,
        businessId,
        requestedBy: userId,
        status: "completed",
        outcome: lead.scan.outcome,
        progress: 100,
        pagesTotal: pages,
        pagesDone: pages,
        force: false,
        cancelRequested: false,
        error: null,
        createdAt: daysAgo(index + 1),
        startedAt: daysAgo(index + 1),
        finishedAt: daysAgo(index + 1),
      });

      scanResults.push({
        _id: scanResultId!,
        workspaceId,
        businessId,
        jobId: scanJobId,
        outcome: lead.scan.outcome,
        chatbotResult: lead.scan.chatbot,
        chatWidgets: lead.scan.widgets ?? [],
        platform: lead.scan.platform ?? null,
        platformConfidence: lead.scan.platform ? "medium" : null,
        title: lead.scan.title ?? null,
        lang: "en",
        httpStatus: 200,
        finalUrl: lead.website ?? null,
        pagesScanned: lead.scan.outcome === "success" ? pages : 1,
        pagesSkipped: lead.scan.outcome === "partial" ? Math.max(0, pages - 1) : 0,
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
      });

      activities.push({
        _id: newId(),
        workspaceId,
        businessId,
        type: "scan_completed",
        message:
          lead.scan.outcome === "success"
            ? `Website check completed (${pages} pages).`
            : "Website check partially completed; scan-dependent points were withheld.",
        metadata: { outcome: lead.scan.outcome, chatbot: lead.scan.chatbot },
        actorId: userId,
        createdAt: daysAgo(index + 1),
      });
    }

    activities.push(
      {
        _id: newId(),
        workspaceId,
        businessId,
        type: "imported",
        message: "Imported from demo-fictional-businesses.csv",
        metadata: { importJobId: importJob._id },
        actorId: userId,
        createdAt: daysAgo(9),
      },
      {
        _id: newId(),
        workspaceId,
        businessId,
        type: "status_changed",
        message: `Status set to ${lead.status.replaceAll("_", " ")}.`,
        metadata: { status: lead.status },
        actorId: userId,
        createdAt: daysAgo(index),
      },
    );

    if (lead.notes) {
      notes.push({
        _id: newId(),
        workspaceId,
        businessId,
        body: lead.notes,
        authorId: userId,
        createdAt: daysAgo(index),
        updatedAt: daysAgo(index),
      });
    }

    for (const tagName of lead.tags ?? []) {
      const tagId = tagByName.get(tagName);
      if (tagId) {
        businessTags.push({
          _id: `${businessId}:${tagId}`,
          workspaceId,
          businessId,
          tagId,
        });
      }
    }
  }

  await Promise.all([
    collections.businesses.insertMany(businesses),
    collections.businessLocations.insertMany(locations),
    collections.sourceRecords.insertMany(sources),
    collections.contactPoints.insertMany(contacts),
    collections.scoreResults.insertMany(scoreResults),
  ]);

  const optionalWrites: Array<Promise<unknown>> = [];
  if (evidence.length) optionalWrites.push(collections.evidenceRecords.insertMany(evidence));
  if (scanJobs.length) optionalWrites.push(collections.scanJobs.insertMany(scanJobs));
  if (scanResults.length) optionalWrites.push(collections.scanResults.insertMany(scanResults));
  if (activities.length) optionalWrites.push(collections.activities.insertMany(activities));
  if (notes.length) optionalWrites.push(collections.notes.insertMany(notes));
  if (businessTags.length) optionalWrites.push(collections.businessTags.insertMany(businessTags));
  await Promise.all(optionalWrites);

  const primaryId = leadIdBySource.get("demo-001");
  const duplicateId = leadIdBySource.get("demo-002");
  if (primaryId && duplicateId) {
    const duplicate: DuplicateCandidateDoc = {
      _id: newId(),
      workspaceId,
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
      createdAt: daysAgo(8),
      resolvedAt: null,
      resolvedBy: null,
    };
    await collections.duplicateCandidates.insertOne(duplicate);
  }

  const savedView: SavedViewDoc = {
    _id: newId(),
    workspaceId,
    userId,
    name: "High-score leads",
    query: {
      minScore: "70",
      sort: "score_desc",
      includeArchived: "false",
    },
    createdAt: workspace.createdAt,
  };
  const savedSearch: SavedSearchDoc = {
    _id: newId(),
    workspaceId,
    provider: "osm",
    country: "United Arab Emirates",
    city: "Dubai",
    categories: ["dentist", "salon"],
    limitCount: 50,
    enabled: false,
    lastRunAt: null,
    createdAt: workspace.createdAt,
  };
  const workspaceActivity: ActivityDoc = {
    _id: newId(),
    workspaceId,
    businessId: null,
    type: "imported",
    message: `Demo import completed with ${DEMO_LEADS.length} fictional businesses.`,
    metadata: { importJobId: importJob._id },
    actorId: userId,
    createdAt: daysAgo(9),
  };
  await Promise.all([
    collections.savedViews.insertOne(savedView),
    collections.savedSearches.insertOne(savedSearch),
    collections.activities.insertOne(workspaceActivity),
  ]);

  return { workspaceId, leadCount: businesses.length };
}

async function main(): Promise<void> {
  await ensureIndexes();
  const userId = await ensureDemoUser();

  const existing = await collections.workspaces.findOne({
    slug: DEMO_WORKSPACE_SLUG,
    isDemo: true,
  });
  if (existing) {
    await Promise.all(
      DEMO_SCOPED_COLLECTIONS.map((collection) =>
        collection.deleteMany({ workspaceId: existing._id }),
      ),
    );
    await collections.memberships.deleteMany({ workspaceId: existing._id });
    await collections.workspaces.deleteOne({ _id: existing._id });
  }

  const result = await seedWorkspace(userId);

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
    await closeMongo();
  });
