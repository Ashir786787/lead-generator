import { describe, expect, it } from "vitest";
import { extractPage } from "@/lib/scan/extract";

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <title> Al Noor Dental Studio </title>
    <meta name="generator" content="WordPress 6.5" />
    <link rel="stylesheet" href="/wp-content/theme.css" />
    <script src="https://widget.intercom.io/widget/abc123"></script>
  </head>
  <body>
    <p>Reach us at info@alnoor.example or hello@alnoor.example</p>
    <a href="mailto:hello@alnoor.example">Email</a>
    <a href="mailto:noreply@example.com">Do not use</a>
    <a href="tel:+971 50 123 4567">Call</a>
    <a href="https://wa.me/971501234567?text=Hello">WhatsApp</a>
    <a href="https://calendly.com/alnoor/consult">Book an appointment</a>
    <a href="https://www.instagram.com/alnoor">Instagram</a>
    <a href="/contact">Contact</a>
    <form action="/quote" method="post">
      <input type="email" name="email" />
      <textarea name="message"></textarea>
      <button type="submit">Send</button>
    </form>
  </body>
</html>`;

describe("extractPage", () => {
  const result = extractPage(PAGE, "https://alnoor.example/", "UAE");

  it("extracts page metadata and the platform", () => {
    expect(result.title).toBe("Al Noor Dental Studio");
    expect(result.lang).toBe("en");
    expect(result.generator).toBe("WordPress 6.5");
    expect(result.platform).toBe("WordPress");
    expect(result.platformConfidence).toBe("high");
  });

  it("detects chat widgets from script sources", () => {
    expect(result.chatWidgets.map((widget) => widget.name)).toContain("Intercom");
    expect(result.chatWidgets[0]?.confidence).toBe("high");
  });

  it("collects public emails while dropping junk addresses", () => {
    const emails = result.emails.map((email) => email.value);
    expect(emails).toContain("hello@alnoor.example");
    expect(emails).toContain("info@alnoor.example");
    expect(emails).not.toContain("noreply@example.com");
    expect(result.emails.find((email) => email.value === "hello@alnoor.example")?.source).toBe(
      "mailto",
    );
  });

  it("parses phone and WhatsApp links", () => {
    expect(result.phones[0]?.e164).toBe("+971501234567");
    expect(result.whatsapps[0]?.e164).toBe("+971501234567");
    expect(result.whatsapps[0]?.value).toContain("wa.me");
  });

  it("recognises social profiles, booking and inquiry forms", () => {
    expect(result.socials.some((social) => social.platform === "Instagram")).toBe(true);
    expect(result.hasBooking).toBe(true);
    expect(result.hasContactForm).toBe(true);
    expect(result.hasInquiryForm).toBe(true);
  });

  it("keeps same-origin links for further crawling", () => {
    expect(result.links.some((link) => link.href === "https://alnoor.example/contact")).toBe(true);
    expect(result.links.every((link) => link.href.startsWith("https://alnoor.example/"))).toBe(true);
  });

  it("reports an honest empty result when nothing is present", () => {
    const empty = extractPage(
      "<html><head><title>Plain</title></head><body><p>Hello</p></body></html>",
      "https://plain.example/",
    );
    expect(empty.emails).toEqual([]);
    expect(empty.phones).toEqual([]);
    expect(empty.whatsapps).toEqual([]);
    expect(empty.chatWidgets).toEqual([]);
    expect(empty.hasBooking).toBe(false);
    expect(empty.hasContactForm).toBe(false);
    expect(empty.hasInquiryForm).toBe(false);
  });
});
