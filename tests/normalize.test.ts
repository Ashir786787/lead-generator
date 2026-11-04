import { describe, expect, it } from "vitest";
import {
  normalizeBusiness,
  normalizeCity,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  normalizeWebsite,
  isJunkEmail,
  isNoreply,
  mapCategory,
  nameSimilarity,
  registrableHost,
  sameSite,
} from "@/lib/normalize";

describe("normalizeName", () => {
  it("lower-cases, strips diacritics, legal suffixes and a leading article", () => {
    expect(normalizeName("The Dubai Café LLC")).toBe("dubai cafe");
    expect(normalizeName("  AL   NOOR   DENTAL   CLINIC  ")).toBe("al noor dental clinic");
  });

  it("expands ampersands for comparison without touching display data", () => {
    expect(normalizeName("Acme & Sons Ltd")).toBe("acme and sons");
  });

  it("normalises Arabic forms", () => {
    expect(normalizeName("مقهى الأندلس")).toBe("مقهي الاندلس");
  });

  it("removes stacked legal suffixes", () => {
    expect(normalizeName("Gulf Trading Co. LLC")).toBe("gulf trading");
  });
});

describe("normalizeCity", () => {
  it("uses known aliases", () => {
    expect(normalizeCity("DXB")).toBe("dubai");
    expect(normalizeCity("New York City")).toBe("new york");
    expect(normalizeCity("Karāchi")).toBe("karachi");
  });
});

describe("similarity helpers", () => {
  it("scores identical names at 1 and similar names highly", () => {
    expect(nameSimilarity("Al Noor Dental Clinic", "Al Noor Dental Clinic LLC")).toBe(1);
    expect(nameSimilarity("Al Noor Dental Clinic", "Al Noor Dental Care")).toBeGreaterThan(0.85);
  });

  it("keeps unrelated names low", () => {
    expect(nameSimilarity("Northside Dental", "Harbour Legal Advisors")).toBeLessThan(0.6);
  });
});

describe("normalizeWebsite", () => {
  it("adds a scheme, strips credentials/tracking/fragments and lower-cases the host", () => {
    const result = normalizeWebsite(
      "HTTPS://WWW.Example.CO.UK/Path?gclid=123&utm_source=news&keep=1#section",
    );
    expect(result).not.toBeNull();
    expect(result?.scheme).toBe("https");
    expect(result?.host).toBe("www.example.co.uk");
    expect(result?.comparisonHost).toBe("example.co.uk");
    expect(result?.registrableHost).toBe("example.co.uk");
    expect(result?.url).toBe("https://www.example.co.uk/Path?keep=1");
  });

  it("rejects non-web, credential-bearing and malformed URLs", () => {
    expect(normalizeWebsite("ftp://example.com")).toBeNull();
    expect(normalizeWebsite("https://user:pass@example.com")).toBeNull();
    expect(normalizeWebsite("not a url")).toBeNull();
    expect(normalizeWebsite("http://localhost")).toBeNull();
  });

  it("compares registrable domains", () => {
    expect(registrableHost("a.b.example.com")).toBe("example.com");
    expect(registrableHost("shop.example.co.uk")).toBe("example.co.uk");
    expect(sameSite("https://www.example.com/a", "https://app.example.com/b")).toBe(true);
    expect(sameSite("https://example.com", "https://example.org")).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("parses an international UAE mobile number", () => {
    const result = normalizePhone("+971 50 123 4567", "UAE");
    expect(result?.e164).toBe("+971501234567");
    expect(result?.valid).toBe(true);
  });

  it("uses the lead country for national formats", () => {
    const result = normalizePhone("050 123 4567", "United Arab Emirates");
    expect(result?.e164).toBe("+971501234567");
    expect(result?.valid).toBe(true);
  });

  it("classifies mobile numbers where the metadata supports it", () => {
    const result = normalizePhone("07911 123456", "UK");
    expect(result?.e164).toBe("+447911123456");
    expect(result?.kind).toBe("mobile");
  });

  it("does not invent a phone record for junk input", () => {
    expect(normalizePhone("call us maybe", null)).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lower-cases, strips mailto and query strings", () => {
    expect(normalizeEmail(" MailTo:Info@Example.COM?subject=Hello ")).toBe("info@example.com");
  });

  it("flags placeholder and decorative addresses as junk", () => {
    expect(isJunkEmail("noreply@example.com")).toBe(true);
    expect(isJunkEmail("logo@brand.png")).toBe(true);
    expect(isJunkEmail("owner@sentry.io")).toBe(true);
    expect(isJunkEmail("hello@real-business.com")).toBe(false);
    expect(isNoreply("no-reply@real-business.com")).toBe(true);
  });
});

describe("mapCategory", () => {
  it("maps common industry phrases", () => {
    expect(mapCategory("Restaurant").key).toBe("restaurant");
    expect(mapCategory("Dentist").key).toBe("dentist");
    expect(mapCategory("Beauty salon").key).toBe("salon");
    expect(mapCategory("Fitness centre").key).toBe("gym");
    expect(mapCategory("Lawyer").key).toBe("law_firm");
  });

  it("falls back to other while keeping the raw label", () => {
    const mapping = mapCategory("Underwater basket weaving");
    expect(mapping.key).toBe("other");
    expect(mapping.label).toBe("Underwater basket weaving");
  });

  it("honours explicit overrides", () => {
    expect(mapCategory("Random", { random: "hotel" }).key).toBe("hotel");
  });
});

describe("normalizeBusiness", () => {
  it("combines every normaliser into one record", () => {
    const result = normalizeBusiness({
      name: "The Marina Dental Clinic LLC",
      category: "Dentist",
      website: "marina-dental.example",
      phone: "050 123 4567",
      email: "Hello@Marina-Dental.Example",
      city: "DXB",
      country: "UAE",
    });
    expect(result.normalizedName).toBe("marina dental clinic");
    expect(result.categoryKey).toBe("dentist");
    expect(result.cityNormalized).toBe("dubai");
    expect(result.website?.url).toBe("https://marina-dental.example");
    expect(result.phone?.e164).toBe("+971501234567");
    expect(result.email).toBe("hello@marina-dental.example");
  });
});
