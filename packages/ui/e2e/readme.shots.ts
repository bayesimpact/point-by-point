// Screenshots for the README, in light and dark: `pnpm --filter @point-by-point/ui shots` after a build.
// Not part of the e2e suite (playwright.shots.config.ts only).
import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import type { MountOptions } from "./harness/host";

const OUT = new URL("../../../docs/images/", import.meta.url).pathname;

const RESPONSE = `## Migration plan

First we migrate the database. The new schema adds two columns and backfills them in batches of 10,000 rows.

Then we deploy the new API behind a feature flag. Once the health checks pass, we switch traffic progressively: 10%, then 50%, then 100%.

The whole operation takes about two hours, and rolling back is a single flag flip.`;

const ANSWER = `> Back it up first.

Agreed: the migration now starts with a snapshot of the production database, kept for seven days.

> When exactly? Not during business hours.

The switch starts at 7 pm, after peak traffic, and each step waits for fifteen minutes of clean metrics.

I'll write the runbook next, with the rollback steps at the top.`;

// Close to the variables Claude passes to interfaces, and to its page background.
const THEMES = {
  light: {
    page: "#faf9f5",
    variables: {
      "--color-background-primary": "#ffffff",
      "--color-background-secondary": "#f5f4ed",
      "--color-text-primary": "#141413",
      "--color-text-secondary": "#3d3d3a",
      "--color-text-tertiary": "#73726c",
      "--color-border-secondary": "rgba(31, 30, 29, 0.3)",
    },
  },
  dark: {
    page: "#262624",
    variables: {
      "--color-background-primary": "#30302e",
      "--color-background-secondary": "#262624",
      "--color-text-primary": "#faf9f5",
      "--color-text-secondary": "#c2c0b6",
      "--color-text-tertiary": "#9c9a92",
      "--color-border-secondary": "rgba(222, 220, 209, 0.3)",
    },
  },
} as const;

test.use({ viewport: { width: 720, height: 200 }, deviceScaleFactor: 2 });

async function mount(page: Page, theme: keyof typeof THEMES, markdown: string): Promise<FrameLocator> {
  const { page: background, variables } = THEMES[theme];
  await page.emulateMedia({ colorScheme: theme });
  await page.goto("/");
  await page.addStyleTag({
    content: `:root { color-scheme: ${theme}; } body { background: ${background}; padding: 24px 28px 4px; } iframe { margin: 0; }`,
  });
  const options = { args: { markdown }, context: { theme, locale: "en-US", styles: { variables } } };
  await page.evaluate((value) => window.mount(value as unknown as MountOptions), JSON.parse(JSON.stringify(options)));
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator(".phrase").first()).toBeVisible();
  return frame;
}

/** Selects a passage, as a drag with the mouse does. */
async function selectPassage(frame: FrameLocator, passage: string) {
  await frame.locator("#content").evaluate((content, text) => {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const start = node.textContent!.indexOf(text);
      if (start < 0) continue;
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + text.length);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(range);
      content.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return;
    }
    throw new Error(`passage not found: ${text}`);
  }, passage);
}

async function settle(page: Page) {
  await page.mouse.move(0, 0);
  // The notes animate in.
  await page.waitForTimeout(1000);
}

for (const theme of ["light", "dark"] as const) {
  test(`annotating (${theme})`, async ({ page }) => {
    const frame = await mount(page, theme, RESPONSE);
    await selectPassage(frame, "First we migrate the database.");
    await frame.locator(".note textarea").last().fill("Back it up first.");
    // A selection made while a field has the focus belongs to the field.
    await frame.locator(".note textarea").last().blur();
    await selectPassage(frame, "switch traffic");
    await expect(frame.locator(".note")).toHaveCount(2);
    await frame.locator(".note textarea").last().fill("When exactly? Not during business hours.");
    await frame.locator(".note textarea").last().blur();
    await settle(page);
    await page.screenshot({ path: `${OUT}annotate-${theme}.png`, fullPage: true });
  });

  test(`answer (${theme})`, async ({ page }) => {
    await mount(page, theme, ANSWER);
    await settle(page);
    await page.screenshot({ path: `${OUT}answer-${theme}.png`, fullPage: true });
  });
}
