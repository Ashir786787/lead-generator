import "dotenv/config";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Captures the app in light and dark mode at the three review widths.
 *
 * Usage:
 *   pnpm build
 *   pnpm start            # in another terminal, on http://localhost:3000
 *   pnpm seed:demo        # clean, deterministic demo workspace
 *   pnpm screenshots
 *
 * The script signs in with the demo owner, so no real workspace data is
 * photographed. Output goes to docs/screenshots/.
 */

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const OUTPUT_DIR = path.join(process.cwd(), "docs", "screenshots");
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? "demo@leadfinder.example";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 768 },
  { name: "390", width: 390, height: 844 },
] as const;

interface Screen {
  name: string;
  path: string;
  ready: (page: Page) => Promise<void>;
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(DEMO_EMAIL);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${BASE_URL}/`);
  await page.getByRole("heading", { level: 1 }).waitFor();
}

async function resolveDemoLeadId(context: BrowserContext): Promise<string> {
  const response = await context.request.get("/api/leads?q=Marina%20Smile%20Studio");
  if (!response.ok()) {
    throw new Error(`Could not load demo leads (HTTP ${response.status()}).`);
  }
  const body = (await response.json()) as { items?: Array<{ id: string; name: string }> };
  const lead = body.items?.find((item) => item.name === "Marina Smile Studio");
  if (!lead) {
    throw new Error("Marina Smile Studio is missing. Run `pnpm seed:demo` first.");
  }
  return lead.id;
}

function buildScreens(leadId: string): Screen[] {
  return [
    {
      name: "dashboard",
      path: "/",
      ready: async (page) => {
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.getByText("Outreach stays manual", { exact: false }).first().waitFor();
      },
    },
    {
      name: "leads",
      path: "/leads",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Leads", exact: true }).waitFor();
        await page.getByText("Marina Smile Studio").first().waitFor();
      },
    },
    {
      name: "lead-detail",
      path: `/leads/${leadId}`,
      ready: async (page) => {
        await page.getByRole("heading", { level: 1 }).waitFor();
        await page.getByText("Score breakdown").waitFor();
      },
    },
    {
      name: "duplicates",
      path: "/duplicates",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Possible duplicates", exact: true }).waitFor();
      },
    },
    {
      name: "imports",
      path: "/imports",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Imports", exact: true }).waitFor();
      },
    },
    {
      name: "discovery",
      path: "/discovery",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Discovery", exact: true }).waitFor();
        await page.getByText("Search a real source").waitFor();
      },
    },
    {
      name: "scans",
      path: "/scans",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Website scans", exact: true }).waitFor();
      },
    },
    {
      name: "settings",
      path: "/settings",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
      },
    },
    {
      name: "scoring",
      path: "/settings/scoring",
      ready: async (page) => {
        await page.getByRole("heading", { name: "Scoring profile", exact: true }).waitFor();
      },
    },
  ];
}

async function applyStableTheme(page: Page, theme: Theme): Promise<void> {
  await page.waitForFunction(
    (expected) => document.documentElement.classList.contains("dark") === (expected === "dark"),
    theme,
  );
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;caret-color:transparent!important}",
  });
}

async function capture(page: Page, screen: Screen, theme: Theme, viewport: string): Promise<void> {
  await page.goto(screen.path, { waitUntil: "networkidle" });
  await screen.ready(page);
  await applyStableTheme(page, theme);
  await page.waitForTimeout(250);
  const file = path.join(OUTPUT_DIR, `${screen.name}-${viewport}-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${path.relative(process.cwd(), file)}`);
}

async function main(): Promise<void> {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const screenshots: string[] = [];

  try {
    const authContext = await browser.newContext({
      baseURL: BASE_URL,
      viewport: { width: 1440, height: 900 },
    });
    const authPage = await authContext.newPage();
    await signIn(authPage);
    const storageState = await authContext.storageState();
    await authContext.close();

    const apiContext = await browser.newContext({ baseURL: BASE_URL, storageState });
    const leadId = await resolveDemoLeadId(apiContext);
    await apiContext.close();

    const screens = buildScreens(leadId);

    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          baseURL: BASE_URL,
          storageState,
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          colorScheme: theme,
        });
        await context.addInitScript((value: Theme) => {
          window.localStorage.setItem("lf-theme", value);
        }, theme);

        const page = await context.newPage();
        for (const screen of screens) {
          await capture(page, screen, theme, viewport.name);
          screenshots.push(`${screen.name}-${viewport.name}-${theme}.png`);
        }
        await context.close();

        // The sign-in screen is captured without a session so it renders fully.
        const loginContext = await browser.newContext({
          baseURL: BASE_URL,
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          colorScheme: theme,
        });
        await loginContext.addInitScript((value: Theme) => {
          window.localStorage.setItem("lf-theme", value);
        }, theme);
        const loginPage = await loginContext.newPage();
        await loginPage.goto("/login", { waitUntil: "networkidle" });
        await loginPage.getByRole("heading", { name: "Welcome back" }).waitFor();
        await applyStableTheme(loginPage, theme);
        await loginPage.waitForTimeout(250);
        const loginFile = path.join(OUTPUT_DIR, `login-${viewport.name}-${theme}.png`);
        await loginPage.screenshot({ path: loginFile, fullPage: true });
        console.log(`captured ${path.relative(process.cwd(), loginFile)}`);
        screenshots.push(`login-${viewport.name}-${theme}.png`);
        await loginContext.close();
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\n${screenshots.length} screenshots written to docs/screenshots/`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
