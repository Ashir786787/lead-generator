import { describe, expect, it } from "vitest";
import { decideDuplicate, DEDUPE_THRESHOLDS, type DedupeRecord } from "@/lib/dedupe/decide";

const DUBAI = { lat: 25.2048, lng: 55.2708 };

function record(overrides: Partial<DedupeRecord> = {}): DedupeRecord {
  return {
    name: "Al Noor Dental Clinic",
    phoneE164: null,
    websiteHost: null,
    street: null,
    lat: null,
    lng: null,
    ...overrides,
  };
}

describe("decideDuplicate", () => {
  it("merges the same phone with a very similar name", () => {
    const decision = decideDuplicate(
      record({ phoneE164: "+971501234567" }),
      record({ name: "Al Noor Dental Clinic LLC", phoneE164: "+971501234567" }),
    );
    expect(decision.action).toBe("merge");
    expect(decision.reason).toMatch(/same phone/i);
  });

  it("merges a shared domain with similar name and the same street", () => {
    const decision = decideDuplicate(
      record({ websiteHost: "www.alnoor.example", street: "12 Marina Walk" }),
      record({
        name: "Al Noor Dental",
        websiteHost: "alnoor.example",
        street: "12, Marina Walk",
      }),
    );
    expect(decision.action).toBe("merge");
    expect(decision.reason).toMatch(/same street/i);
  });

  it("merges a shared domain with similar name within 150 m", () => {
    const decision = decideDuplicate(
      record({ websiteHost: "alnoor.example", ...DUBAI }),
      record({
        name: "Al Noor Dental Center",
        websiteHost: "www.alnoor.example",
        lat: DUBAI.lat + 0.0005,
        lng: DUBAI.lng,
      }),
    );
    expect(decision.action).toBe("merge");
    expect(decision.distanceM).not.toBeNull();
    expect(decision.distanceM ?? Infinity).toBeLessThanOrEqual(
      DEDUPE_THRESHOLDS.hostDistanceMergeM,
    );
  });

  it("refuses to merge on a shared domain alone", () => {
    const decision = decideDuplicate(
      record({ name: "Northside Dental", websiteHost: "shared-platform.example" }),
      record({ name: "Harbour Legal Advisors", websiteHost: "shared-platform.example" }),
    );
    expect(decision.action).toBe("none");
  });

  it("sends a similar name within 100 m to manual review", () => {
    const decision = decideDuplicate(
      record({ name: "Al Noor Dental Clinic", ...DUBAI }),
      record({ name: "Al Noor Dental Care", lat: DUBAI.lat + 0.0004, lng: DUBAI.lng }),
    );
    expect(decision.action).toBe("review");
    expect(decision.reason).toMatch(/within 100 m/i);
  });

  it("sends the same phone with a different name to manual review", () => {
    const decision = decideDuplicate(
      record({ name: "Al Noor Dental Clinic", phoneE164: "+971501234567" }),
      record({ name: "Marina Smile Center", phoneE164: "+971501234567" }),
    );
    expect(decision.action).toBe("review");
    expect(decision.reason).toMatch(/names differ/i);
  });

  it("does not merge similar names that are far apart", () => {
    const decision = decideDuplicate(
      record({ name: "Al Noor Dental Clinic", ...DUBAI }),
      record({ name: "Al Noor Dental Clinic", lat: 25.3, lng: 55.4 }),
    );
    expect(decision.action).toBe("none");
    expect(decision.distanceM ?? 0).toBeGreaterThan(1000);
  });

  it("returns none with a null distance when coordinates are missing", () => {
    const decision = decideDuplicate(
      record({ name: "Al Noor Dental Clinic" }),
      record({ name: "Al Noor Dental Clinic" }),
    );
    expect(decision.action).toBe("none");
    expect(decision.distanceM).toBeNull();
  });
});
