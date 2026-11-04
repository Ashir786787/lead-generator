import { expect, test } from "@playwright/test";

test.describe("discovery", () => {
  test("reports real provider availability without placeholder results", async ({ page }) => {
    await page.goto("/discovery");
    await expect(page.getByRole("heading", { name: "Discovery", exact: true })).toBeVisible();
    await expect(page.getByText("Search a real source")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan with AI", exact: true })).toBeVisible();
    await expect(page.getByText(/AI only plans the search/i).first()).toBeVisible();
    await expect(page.getByText("OpenStreetMap", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Google Places", { exact: false }).first()).toBeVisible();

    // OSM is the built-in live provider; Google needs a key and says so.
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/API key/i).first()).toBeVisible();
  });
});
