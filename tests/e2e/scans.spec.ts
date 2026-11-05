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

  test("does not warn about the worker when automation is running", async ({ page, request }) => {
    // The pg-boss heartbeat can take up to a minute to appear after startup, so
    // poll the API before asserting on the server-rendered banner.
    await expect
      .poll(
        async () => {
          const response = await request.get("/api/scans");
          if (!response.ok()) return false;
          const body = await response.json();
          return body.summary?.workerOnline === true;
        },
        { timeout: 90_000, intervals: [2_000], message: "worker heartbeat never appeared" },
      )
      .toBe(true);

    await page.goto("/scans");
    await expect(page.getByText("Automation worker offline")).toBeHidden();
  });
});
