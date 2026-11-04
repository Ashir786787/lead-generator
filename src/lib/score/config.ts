import { z } from "zod";
import { DEFAULT_SCORE_CONFIG, type ScoreConfig } from "@/lib/score/types";

export const scoreConfigSchema = z.object({
  industryFit: z.object({
    cap: z.number().min(0).max(100),
    defaultPoints: z.number().min(0).max(100),
    categories: z.record(z.string(), z.number().min(0).max(100)),
  }),
  websiteInspected: z.object({ cap: z.number().min(0).max(100) }),
  noChatbot: z.number().min(0).max(100),
  whatsappNoChatbot: z.number().min(0).max(100),
  contactChannels: z.object({
    cap: z.number().min(0).max(100),
    email: z.number().min(0).max(100),
    phone: z.number().min(0).max(100),
    whatsapp: z.number().min(0).max(100),
    contactForm: z.number().min(0).max(100),
  }),
  inquiryInteraction: z.object({
    cap: z.number().min(0).max(100),
    booking: z.number().min(0).max(100),
    inquiryForm: z.number().min(0).max(100),
  }),
});

export function validateScoreConfig(config: ScoreConfig): ScoreConfig {
  const parsed = scoreConfigSchema.parse(config);
  const max =
    parsed.industryFit.cap +
    parsed.websiteInspected.cap +
    parsed.noChatbot +
    parsed.whatsappNoChatbot +
    parsed.contactChannels.cap +
    parsed.inquiryInteraction.cap;
  if (max > 100) {
    throw new Error(`Score components can award up to ${max} points; the maximum is 100.`);
  }
  return parsed;
}

export function cloneDefaultConfig(): ScoreConfig {
  return JSON.parse(JSON.stringify(DEFAULT_SCORE_CONFIG)) as ScoreConfig;
}
