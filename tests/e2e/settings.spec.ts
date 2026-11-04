import { expect, test } from "@playwright/test";

test.describe("settings and scoring", () => {
  test("shows workspace settings, the outreach checklist and isolation notes", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Demo (fictional) workspace").first()).toBeVisible();
    await expect(page.getByText("Data and isolation")).toBeVisible();
    await expect(page.getByText(/never sends email, SMS or WhatsApp/i)).toBeVisible();
    await expect(page.getByText("Outreach checklist")).toBeVisible();
    await expect(page.getByText(/no send button anywhere/i)).toBeVisible();
  });

  test("shows the transparent 100-point scoring profile", async ({ page }) => {
    await page.goto("/settings/scoring");
    await expect(page.getByRole("heading", { name: "Scoring profile" })).toBeVisible();
    await expect(page.getByText("Maximum points")).toBeVisible();
    await expect(page.getByText("100 / 100")).toBeVisible();
    await expect(page.getByText("Industry fit").first()).toBeVisible();
    await expect(page.getByText("How scores stay honest")).toBeVisible();
    await expect(page.getByText(/scan-dependent points are withheld/i).first()).toBeVisible();
  });
});
