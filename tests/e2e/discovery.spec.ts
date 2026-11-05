import { expect, test } from "@playwright/test";

test.describe("discovery", () => {
  test("renders general guidance as chat text without a search plan", async ({ page }) => {
    await page.route("**/api/discovery/plan", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          plan: {
            intent: "advice",
            answer:
              "Start with businesses that already depend on inbound enquiries, such as dentists and law firms. Tell me what you sell and I can narrow it down.",
            planner: "groq",
            model: "test-model",
            provider: "osm",
            country: "",
            city: "",
            categories: [],
            limit: 50,
            reasoning: "General guidance from the assistant.",
            notes: [],
          },
          planners: [],
        }),
      });
    });

    await page.goto("/discovery");
    await page.getByLabel("Ask for leads or for advice").fill("what kind of leads are helpful");
    await page.getByRole("button", { name: "Send", exact: true }).click();

    await expect(page.getByText(/Start with businesses that already depend/i)).toBeVisible();
    await expect(page.getByText(/Guidance only/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Apply to form/i })).toHaveCount(0);
  });

  test("reports real provider availability without placeholder results", async ({ page }) => {
    await page.goto("/discovery");
    await expect(page.getByRole("heading", { name: "Discovery", exact: true })).toBeVisible();
    await expect(page.getByText("Search a real source")).toBeVisible();
    await expect(page.getByRole("heading", { name: "AI search assistant", exact: true })).toBeVisible();
    await expect(page.getByText(/can plan a live search or give general guidance/i).first()).toBeVisible();
    await expect(page.getByText("OpenStreetMap", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Google Places", { exact: false }).first()).toBeVisible();

    // OSM is the built-in live provider; Google needs a key and says so.
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Unavailable", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/API key/i).first()).toBeVisible();
  });
});
