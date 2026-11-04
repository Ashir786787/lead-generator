import { expect, test } from "@playwright/test";

test.describe("imports", () => {
  test("shows the seeded import and its mapping", async ({ page }) => {
    await page.goto("/imports");
    await expect(page.getByRole("heading", { name: "Imports" })).toBeVisible();
    await expect(page.getByText("demo-fictional-businesses.csv").first()).toBeVisible();
    await expect(page.getByText("8", { exact: true }).first()).toBeVisible();
  });

  test("previews a CSV before anything is committed", async ({ page }) => {
    await page.goto("/imports");
    await page.getByRole("button", { name: /Upload a file/i }).click();

    const csv = [
      "Business Name,Category,Website,Phone,Email,Street,City",
      "Test Bakery,Cafe,test-bakery.example,+971 4 555 0199,hello@test-bakery.example,1 Test Road,Dubai",
    ].join("\n");
    await page.locator("#import-file").setInputFiles({
      name: "e2e-preview.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });
    await page.getByRole("button", { name: "Inspect file" }).click();

    await expect(page.getByRole("heading", { name: "Map your columns" })).toBeVisible();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("e2e-preview.csv")).toBeVisible();
    await expect(dialog.getByText("Test Bakery")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start import" })).toBeEnabled();
    await page.getByRole("button", { name: "Choose another file" }).click();
  });
});
