import { expect, test } from "@playwright/test";

test.describe("leads workspace", () => {
  test("lists seeded leads and filters by search", async ({ page }) => {
    await page.goto("/leads");
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();
    await expect(page.getByText("Marina Smile Studio").first()).toBeVisible();
    await expect(page.getByText("Ghaf Coffee House").first()).toBeVisible();

    const search = page.getByLabel("Search leads");
    await search.fill("Cedar");
    await expect(page.getByText("Cedar & Salt Spa").first()).toBeVisible();
    await expect(page.getByText("Marina Smile Studio")).toHaveCount(0);

    await page.getByLabel("Clear search").click();
    await expect(page.getByText("Marina Smile Studio").first()).toBeVisible();
  });

  test("opens a lead and keeps demo attribution visible", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("link", { name: /Marina Smile Studio/ }).first().click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Marina Smile Studio");
    await expect(
      page.getByRole("main").getByText("Demo (fictional)", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText("Score breakdown")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contact channels" })).toBeVisible();
    await page.getByRole("tab", { name: "Website scan" }).click();
    await expect(page.getByRole("heading", { name: "Latest website scan" })).toBeVisible();
    await expect(page.getByText(/never sends anything/i)).toBeVisible();
  });

  test("shows a do-not-contact warning for the suppressed lead", async ({ page, request }) => {
    // Suppressed leads are hidden from the default list, so resolve the id via
    // the API with includeDnc=true instead of guessing a URL.
    const response = await request.get("/api/leads?includeDnc=true&q=Harbour%20Lane");
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as { items: Array<{ id: string; name: string }> };
    const suppressed = body.items.find((item) => item.name === "Harbour Lane Legal");
    expect(suppressed).toBeTruthy();

    await page.goto(`/leads/${suppressed?.id}`);
    await expect(page.getByText("Do not contact").first()).toBeVisible();
  });
});
