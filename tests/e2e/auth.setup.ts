import { expect, test as setup } from "@playwright/test";

export const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@leadfinder.example";
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";

const authFile = "tests/e2e/.auth/demo.json";

setup("sign in as the demo owner", async ({ page }) => {
  await page.goto("/login");
  // Let Next.js hydrate the form: without this the first click can fall back
  // to a native GET submit while the dev server is still compiling.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();

  await page.getByLabel("Email address").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/good /i);
  await expect(page.getByText("Demo workspace.", { exact: true })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
