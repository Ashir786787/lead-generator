import type { ScoreComponent, ScoreConfig, ScoreOutput } from "./types";

export interface ScoreInput {
  categoryKey: string | null;
  scan: {
    outcome: string;
    chatbotResult: string;
    chatWidgets: unknown[];
    confidence?: string | null;
    summary?: Record<string, unknown> | null;
  } | null;
  contacts: Array<{ type: string; normalizedValue?: string }>;
  hasExplicitWhatsapp: boolean;
  hasBooking: boolean;
  hasInquiryForm: boolean;
}

const SCAN_INCOMPLETE = "Scan did not complete — points not awarded.";
const SCAN_FAILED = "No completed website check — points not awarded.";
const NOT_CHECKED = "Website not checked yet — points not awarded.";

export function computeScore(
  input: ScoreInput,
  config: ScoreConfig,
  meta: { profileId: string; profileVersion: number; calculatedAt?: Date },
): ScoreOutput {
  const components: ScoreComponent[] = [];
  const scan = input.scan;
  const completed = scan?.outcome === "success";
  const hasChatWidget = (scan?.chatWidgets?.length ?? 0) > 0;
  const chatbotDetected = scan?.chatbotResult === "detected" || hasChatWidget;

  // 1. Industry fit
  const configuredCategoryPoints = input.categoryKey
    ? config.industryFit.categories[input.categoryKey]
    : undefined;
  const categoryPoints = configuredCategoryPoints ?? config.industryFit.defaultPoints;
  components.push({
    key: "industry_fit",
    label: "Industry fit",
    points: Math.min(config.industryFit.cap, Math.max(0, categoryPoints)),
    max: config.industryFit.cap,
    reason:
      configuredCategoryPoints !== undefined && input.categoryKey
        ? `Category “${input.categoryKey}” scores ${configuredCategoryPoints} of ${config.industryFit.cap}.`
        : input.categoryKey
          ? `Category “${input.categoryKey}” is not in the scoring profile; default ${config.industryFit.defaultPoints} points.`
          : `Category not recognised; default ${config.industryFit.defaultPoints} points.`,
  });

  // 2. Website successfully inspected
  if (completed) {
    components.push({
      key: "website_inspected",
      label: "Website successfully inspected",
      points: config.websiteInspected.cap,
      max: config.websiteInspected.cap,
      reason: "The public website was fetched and parsed.",
    });
  } else {
    components.push({
      key: "website_inspected",
      label: "Website successfully inspected",
      points: 0,
      max: config.websiteInspected.cap,
      reason: !scan ? NOT_CHECKED : scan.outcome === "partial" ? SCAN_INCOMPLETE : SCAN_FAILED,
      withheld: true,
    });
  }

  // 3. No chatbot / chat widget after a completed scan
  if (!scan) {
    components.push({
      key: "no_chatbot",
      label: "No chat widget detected",
      points: 0,
      max: config.noChatbot,
      reason: NOT_CHECKED,
      withheld: true,
    });
  } else if (!completed) {
    components.push({
      key: "no_chatbot",
      label: "No chat widget detected",
      points: 0,
      max: config.noChatbot,
      reason: scan.outcome === "partial" ? SCAN_INCOMPLETE : SCAN_FAILED,
      withheld: true,
    });
  } else if (chatbotDetected) {
    components.push({
      key: "no_chatbot",
      label: "No chat widget detected",
      points: 0,
      max: config.noChatbot,
      reason: "A chat widget or chatbot was detected in the checked pages.",
    });
  } else {
    components.push({
      key: "no_chatbot",
      label: "No chat widget detected",
      points: config.noChatbot,
      max: config.noChatbot,
      reason: "The completed scan found no chat widget in the checked pages.",
    });
  }

  // 4. Explicit WhatsApp link without an embedded chatbot
  if (input.hasExplicitWhatsapp && completed && !chatbotDetected) {
    components.push({
      key: "whatsapp_no_chatbot",
      label: "Explicit WhatsApp link, no chatbot",
      points: config.whatsappNoChatbot,
      max: config.whatsappNoChatbot,
      reason: "A public wa.me / WhatsApp link was found and no chat widget was detected.",
    });
  } else {
    components.push({
      key: "whatsapp_no_chatbot",
      label: "Explicit WhatsApp link, no chatbot",
      points: 0,
      max: config.whatsappNoChatbot,
      reason: !input.hasExplicitWhatsapp
        ? "No explicit WhatsApp link found. A mobile number alone is not a WhatsApp account."
        : !completed
          ? scan
            ? SCAN_INCOMPLETE
            : NOT_CHECKED
          : "A chat widget was detected, so the no-chatbot bonus does not apply.",
      withheld: !completed,
    });
  }

  // 5. Public contact channels
  const hasEmail = input.contacts.some((contact) => contact.type === "email");
  const hasPhone = input.contacts.some((contact) => contact.type === "phone");
  const hasContactForm = input.contacts.some((contact) => contact.type === "contact_form");
  let contactPoints = 0;
  const contactBits: string[] = [];
  if (hasEmail) {
    contactPoints += config.contactChannels.email;
    contactBits.push(`email +${config.contactChannels.email}`);
  }
  if (hasPhone) {
    contactPoints += config.contactChannels.phone;
    contactBits.push(`phone +${config.contactChannels.phone}`);
  }
  if (input.hasExplicitWhatsapp && completed) {
    contactPoints += config.contactChannels.whatsapp;
    contactBits.push(`WhatsApp link +${config.contactChannels.whatsapp}`);
  }
  if (hasContactForm && completed) {
    contactPoints += config.contactChannels.contactForm;
    contactBits.push(`contact form +${config.contactChannels.contactForm}`);
  }
  components.push({
    key: "contact_channels",
    label: "Public contact channels",
    points: Math.min(config.contactChannels.cap, contactPoints),
    max: config.contactChannels.cap,
    reason: contactBits.length ? contactBits.join(" · ") : "No public contact channels found.",
  });

  // 6. Observed inquiry / booking interaction
  let interactionPoints = 0;
  const interactionBits: string[] = [];
  if (completed && input.hasBooking) {
    interactionPoints += config.inquiryInteraction.booking;
    interactionBits.push(`booking/appointment +${config.inquiryInteraction.booking}`);
  }
  if (completed && input.hasInquiryForm) {
    interactionPoints += config.inquiryInteraction.inquiryForm;
    interactionBits.push(`inquiry/quote form +${config.inquiryInteraction.inquiryForm}`);
  }
  components.push({
    key: "inquiry_interaction",
    label: "Inquiry / booking interaction",
    points: Math.min(config.inquiryInteraction.cap, interactionPoints),
    max: config.inquiryInteraction.cap,
    reason: interactionBits.length
      ? interactionBits.join(" · ")
      : completed
        ? "No booking widget, appointment link or dedicated inquiry form found."
        : scan
          ? SCAN_INCOMPLETE
          : NOT_CHECKED,
    withheld: !completed,
  });

  const total = components.reduce((sum, component) => sum + component.points, 0);
  return {
    total,
    components,
    profileId: meta.profileId,
    profileVersion: meta.profileVersion,
    calculatedAt: (meta.calculatedAt ?? new Date()).toISOString(),
  };
}
