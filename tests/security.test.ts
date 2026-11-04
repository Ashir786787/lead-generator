import { describe, expect, it } from "vitest";
import {
  isPrivateAddress,
  resolveScanTarget,
  sameSiteUrl,
  UnsafeTargetError,
} from "@/lib/scan/ssrf";

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.5.4",
    "172.31.255.255",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"])(
    "allows public address %s",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );
});

describe("resolveScanTarget", () => {
  it("rejects non-http schemes", async () => {
    await expect(resolveScanTarget("ftp://example.com/file")).rejects.toThrow(UnsafeTargetError);
  });

  it("rejects malformed URLs", async () => {
    await expect(resolveScanTarget("not a url")).rejects.toThrow(/not valid/i);
  });

  it("rejects embedded credentials", async () => {
    await expect(resolveScanTarget("https://user:pass@example.com")).rejects.toThrow(
      /credentials/i,
    );
  });

  it.each([
    "http://localhost",
    "http://localhost.localdomain",
    "http://metadata.google.internal",
    "http://printer.local",
    "http://service.internal",
    "http://intranet",
  ])("rejects local/metadata host %s", async (target) => {
    await expect(resolveScanTarget(target)).rejects.toThrow(UnsafeTargetError);
  });

  it("rejects loopback literals while the test escape hatch is off", async () => {
    await expect(resolveScanTarget("http://127.0.0.1")).rejects.toThrow(/private, loopback/i);
    await expect(resolveScanTarget("http://[::1]")).rejects.toThrow(/private, loopback/i);
  });

  it("rejects non-standard ports outside the test escape hatch", async () => {
    await expect(resolveScanTarget("http://93.184.216.34:8080")).rejects.toThrow(
      /standard web ports/i,
    );
  });

  it("accepts a public literal address and computes the registrable host", async () => {
    const target = await resolveScanTarget("https://93.184.216.34/");
    expect(target.hostname).toBe("93.184.216.34");
    expect(target.registrable).toBe("216.34");
    expect(target.addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("accepts a public IPv6 literal", async () => {
    const target = await resolveScanTarget("http://[2606:4700:4700::1111]/");
    expect(target.hostname).toBe("2606:4700:4700::1111");
    expect(target.addresses).toEqual([
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
  });
});

describe("sameSiteUrl", () => {
  it("treats sibling subdomains of the same registrable domain as same-site", () => {
    expect(
      sameSiteUrl(new URL("https://www.example.co.uk/a"), new URL("https://shop.example.co.uk/b")),
    ).toBe(true);
  });

  it("rejects cross-domain redirects", () => {
    expect(sameSiteUrl(new URL("https://example.com"), new URL("https://example.org"))).toBe(false);
  });
});
