import { expect, test } from "@playwright/test";

test.describe("responsive shell", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("opens the mobile navigation and reaches a page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: "Leads" }).click();
    await expect(page).toHaveURL(/\/leads/);
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
  });

  test("dark mode can be selected and persists", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Switch theme/ }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.getByRole("button", { name: /Switch theme/ }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});
