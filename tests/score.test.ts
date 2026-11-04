import { describe, expect, it } from "vitest";
import { computeScore, type ScoreInput } from "@/lib/score/engine";
import { DEFAULT_SCORE_CONFIG } from "@/lib/score/types";

const META = { profileId: "profile-1", profileVersion: 1 };

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    categoryKey: "restaurant",
    scan: {
      outcome: "success",
      chatbotResult: "not_detected",
      chatWidgets: [],
    },
    contacts: [{ type: "email" }, { type: "phone" }, { type: "contact_form" }],
    hasExplicitWhatsapp: true,
    hasBooking: true,
    hasInquiryForm: true,
    ...overrides,
  };
}

describe("default score config", () => {
  it("totals exactly 100 points", () => {
    const config = DEFAULT_SCORE_CONFIG;
    const total =
      config.industryFit.cap +
      config.websiteInspected.cap +
      config.noChatbot +
      config.whatsappNoChatbot +
      config.contactChannels.cap +
      config.inquiryInteraction.cap;
    expect(total).toBe(100);
  });
});

describe("computeScore", () => {
  it("awards a perfect 100 for a fully observed strong-fit lead", () => {
    const result = computeScore(input(), DEFAULT_SCORE_CONFIG, META);
    expect(result.total).toBe(100);
    expect(result.components.map((component) => component.key)).toEqual([
      "industry_fit",
      "website_inspected",
      "no_chatbot",
      "whatsapp_no_chatbot",
      "contact_channels",
      "inquiry_interaction",
    ]);
    expect(result.profileId).toBe("profile-1");
    expect(result.profileVersion).toBe(1);
  });

  it("never awards scan-dependent points when the website was never checked", () => {
    const result = computeScore(input({ scan: null }), DEFAULT_SCORE_CONFIG, META);
    const byKey = Object.fromEntries(result.components.map((component) => [component.key, component]));

    expect(byKey.website_inspected?.points).toBe(0);
    expect(byKey.website_inspected?.withheld).toBe(true);
    expect(byKey.no_chatbot?.points).toBe(0);
    expect(byKey.no_chatbot?.withheld).toBe(true);
    expect(byKey.whatsapp_no_chatbot?.points).toBe(0);
    expect(byKey.whatsapp_no_chatbot?.withheld).toBe(true);
    expect(byKey.inquiry_interaction?.points).toBe(0);
    expect(byKey.inquiry_interaction?.withheld).toBe(true);

    // Only the category fit and imported email/phone channels survive; the
    // WhatsApp link and contact form are scan-derived, so they stay withheld.
    expect(byKey.contact_channels?.points).toBe(
      DEFAULT_SCORE_CONFIG.contactChannels.email + DEFAULT_SCORE_CONFIG.contactChannels.phone,
    );
    expect(result.total).toBe(42);
    expect(result.total).toBe(result.components.reduce((sum, c) => sum + c.points, 0));
  });

  it("withholds scan-dependent points for partial and failed scans", () => {
    for (const outcome of ["partial", "failed", "blocked"]) {
      const result = computeScore(
        input({ scan: { outcome, chatbotResult: "unknown", chatWidgets: [] } }),
        DEFAULT_SCORE_CONFIG,
        META,
      );
      const byKey = Object.fromEntries(result.components.map((component) => [component.key, component]));
      expect(byKey.website_inspected?.points, outcome).toBe(0);
      expect(byKey.website_inspected?.withheld, outcome).toBe(true);
      expect(byKey.no_chatbot?.points, outcome).toBe(0);
      expect(byKey.whatsapp_no_chatbot?.points, outcome).toBe(0);
      expect(byKey.inquiry_interaction?.points, outcome).toBe(0);
      expect(result.total, outcome).toBe(42);
    }
  });

  it("withdraws the no-chatbot bonus when a widget was detected", () => {
    for (const scan of [
      { outcome: "success", chatbotResult: "detected", chatWidgets: [] },
      { outcome: "success", chatbotResult: "not_detected", chatWidgets: [{ name: "Intercom" }] },
    ]) {
      const result = computeScore(input({ scan }), DEFAULT_SCORE_CONFIG, META);
      const byKey = Object.fromEntries(result.components.map((component) => [component.key, component]));
      expect(byKey.no_chatbot?.points).toBe(0);
      expect(byKey.no_chatbot?.withheld).toBeUndefined();
      expect(byKey.whatsapp_no_chatbot?.points).toBe(0);
      expect(byKey.whatsapp_no_chatbot?.reason).toMatch(/chat widget/i);
      // Category 30 + website 15 + contact channels 20 + inquiry 10
      expect(result.total).toBe(75);
    }
  });

  it("does not treat a plain mobile number as WhatsApp", () => {
    const result = computeScore(
      input({ hasExplicitWhatsapp: false, contacts: [{ type: "phone" }] }),
      DEFAULT_SCORE_CONFIG,
      META,
    );
    const byKey = Object.fromEntries(result.components.map((component) => [component.key, component]));
    expect(byKey.whatsapp_no_chatbot?.points).toBe(0);
    expect(byKey.whatsapp_no_chatbot?.reason).toMatch(/mobile number alone/i);
    expect(byKey.contact_channels?.points).toBe(DEFAULT_SCORE_CONFIG.contactChannels.phone);
  });

  it("caps contact and interaction components at their configured maximum", () => {
    const result = computeScore(
      input({
        contacts: [{ type: "email" }, { type: "phone" }, { type: "contact_form" }],
        hasExplicitWhatsapp: true,
        hasBooking: true,
        hasInquiryForm: true,
      }),
      DEFAULT_SCORE_CONFIG,
      META,
    );
    const byKey = Object.fromEntries(result.components.map((component) => [component.key, component]));
    expect(byKey.contact_channels?.points).toBe(DEFAULT_SCORE_CONFIG.contactChannels.cap);
    expect(byKey.inquiry_interaction?.points).toBe(DEFAULT_SCORE_CONFIG.inquiryInteraction.cap);
  });

  it("uses the configured default for unknown categories", () => {
    const result = computeScore(
      input({ categoryKey: "not_a_category" }),
      DEFAULT_SCORE_CONFIG,
      META,
    );
    const component = result.components.find((entry) => entry.key === "industry_fit");
    expect(component?.points).toBe(DEFAULT_SCORE_CONFIG.industryFit.defaultPoints);
    expect(component?.reason).toMatch(/not recognised|unknown|default/i);
  });

  it("stamps the calculation time when supplied", () => {
    const calculatedAt = new Date("2026-01-02T03:04:05.000Z");
    const result = computeScore(input(), DEFAULT_SCORE_CONFIG, { ...META, calculatedAt });
    expect(result.calculatedAt).toBe(calculatedAt.toISOString());
  });
});
