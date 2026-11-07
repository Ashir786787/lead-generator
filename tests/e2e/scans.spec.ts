import { expect, test } from "@playwright/test";

test.describe("website scans", () => {
  test("keeps incomplete scans clearly labelled", async ({ page }) => {
    await page.goto("/scans");
    await expect(page.getByRole("heading", { name: "Website scans" })).toBeVisible();
    await expect(page.getByText("How to read scan results")).toBeVisible();
    await expect(page.getByText(/Not detected in checked/i).first()).toBeVisible();
    await expect(page.getByText(/never treated as/i).first()).toBeVisible();

    // The seeded partial scan must be visible as needing a manual look.
    await expect(page.getByText("Northline Accounting").first()).toBeVisible();
    await expect(page.getByText(/Scan incomplete|Needs manual review/i).first()).toBeVisible();
  });

  test("runs scans inline without a worker warning", async ({ page, request }) => {
    const response = await request.get("/api/scans");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.summary?.workerOnline).toBe(true);

    await page.goto("/scans");
    await expect(page.getByText("Automation worker offline")).toBeHidden();
  });
});
