import { expect, test } from "@playwright/test";

test.describe("duplicates", () => {
  test("shows the pending pair and the review-before-merge policy", async ({ page }) => {
    await page.goto("/duplicates");
    await expect(page.getByRole("heading", { name: "Possible duplicates" })).toBeVisible();
    await expect(page.getByText("Review before merge")).toBeVisible();
    await expect(page.getByText("Undo is available")).toBeVisible();
    await expect(page.getByText(/% match/)).toBeVisible();
    await expect(page.getByText("Marina Smile Studio").first()).toBeVisible();
    await expect(page.getByText("Marina Smile Dental Care").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Undo last merge/ })).toBeVisible();
  });
});
