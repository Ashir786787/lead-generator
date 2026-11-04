export interface ScoreConfig {
  /** Max points available for a strong category fit. */
  industryFit: {
    cap: number;
    defaultPoints: number;
    categories: Record<string, number>;
  };
  /** Points when a website was fully inspected (outcome === success). */
  websiteInspected: {
    cap: number;
  };
  /** Awarded only when a COMPLETED scan found no chat widget. */
  noChatbot: number;
  /** Extra points for an explicit WhatsApp link when no embedded chatbot was found. */
  whatsappNoChatbot: number;
  contactChannels: {
    cap: number;
    email: number;
    phone: number;
    whatsapp: number;
    contactForm: number;
  };
  inquiryInteraction: {
    cap: number;
    booking: number;
    inquiryForm: number;
  };
}

export interface ScoreComponent {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
  evidence?: string;
  /** true when the component was not awarded because of a failed/partial scan */
  withheld?: boolean;
}

export type ScoreComponents = ScoreComponent[];

export interface ScoreOutput {
  total: number;
  components: ScoreComponents;
  profileId: string;
  profileVersion: number;
  calculatedAt: string;
}

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  industryFit: {
    cap: 30,
    defaultPoints: 10,
    categories: {
      restaurant: 30,
      cafe: 28,
      clinic: 30,
      dentist: 30,
      salon: 28,
      spa: 26,
      gym: 26,
      hotel: 24,
      real_estate: 26,
      law_firm: 24,
      accounting: 22,
      education: 22,
      ecommerce: 24,
      retail: 18,
      automotive: 18,
      construction: 16,
      travel: 24,
      other: 10,
    },
  },
  websiteInspected: { cap: 15 },
  noChatbot: 20,
  whatsappNoChatbot: 5,
  contactChannels: { cap: 20, email: 8, phone: 4, whatsapp: 4, contactForm: 4 },
  inquiryInteraction: { cap: 10, booking: 6, inquiryForm: 4 },
};

export const CATEGORY_KEYS = [
  "restaurant",
  "cafe",
  "clinic",
  "dentist",
  "salon",
  "spa",
  "gym",
  "hotel",
  "real_estate",
  "law_firm",
  "accounting",
  "education",
  "ecommerce",
  "retail",
  "automotive",
  "construction",
  "travel",
  "other",
] as const;

export type CategoryKey = (typeof CATEGORY_KEYS)[number];
