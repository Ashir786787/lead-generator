import { expect, test } from "@playwright/test";

test.describe("dashboard", () => {
  test("shows the demo workspace, pipeline and honest labels", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/good /i);
    await expect(page.getByText("Demo workspace.", { exact: true })).toBeVisible();
    await expect(page.getByText("You are exploring a fictional demo workspace.")).toBeVisible();

    await expect(page.getByText("Pipeline", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Possible duplicates to review")).toBeVisible();
    await expect(page.getByText("Scans needing a manual look")).toBeVisible();

    // The app must never imply it sends outreach.
    await expect(page.getByText(/Outreach stays manual/i)).toBeVisible();
  });
});
