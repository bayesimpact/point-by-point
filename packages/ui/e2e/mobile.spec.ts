import { expect, test, type Page } from "@playwright/test";
import type { MountOptions } from "./harness/host";

const MARKDOWN = "First point here. Second point here.\n\nAnother paragraph.";

async function mount(page: Page, options: Partial<MountOptions> = {}) {
  await page.goto("/");
  const opts = JSON.parse(JSON.stringify({ args: { markdown: MARKDOWN }, ...options })) as unknown;
  await page.evaluate((value) => window.mount(value as MountOptions), opts);
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator(".phrase").first()).toBeVisible();
  return frame;
}

test("does not open the keyboard when a note is created", async ({ page }) => {
  const frame = await mount(page);
  await frame.locator(".phrase", { hasText: "Second point here." }).tap();
  await expect(frame.locator(".note")).toHaveCount(1);
  await expect(frame.locator(".note textarea")).not.toBeFocused();
});

test("falls back to the focus mode when fullscreen is not available", async ({ page }) => {
  const frame = await mount(page);
  await frame.locator(".phrase", { hasText: "Second point here." }).tap();
  await frame.locator(".note textarea").tap();
  await expect(frame.locator("body")).toHaveClass(/focus-mode/);
  await expect(frame.locator(".phrase", { hasText: "Another paragraph." })).toBeHidden();
  await expect(frame.locator(".note-quote")).toBeVisible();
  await frame.locator(".note .note-done").tap();
  await expect(frame.locator("body")).not.toHaveClass(/focus-mode/);
  await expect(frame.locator(".phrase", { hasText: "Another paragraph." })).toBeVisible();
  await expect(frame.locator(".note")).toHaveCount(1);
});

test("asks for fullscreen when the host offers it, stays there between notes, and returns inline on request", async ({
  page,
}) => {
  const frame = await mount(page, { allowFullscreen: true });
  const displayModes = async () => (await page.evaluate(() => window.recorded)).displayModes;
  await frame.locator(".phrase", { hasText: "First point here." }).tap();
  await expect(frame.locator("body")).toHaveClass(/sheet/);
  await expect(frame.locator(".phrase", { hasText: "Another paragraph." })).toBeHidden();
  await expect(frame.locator("#collapse")).toBeHidden();

  // Done shows the whole response, still fullscreen.
  await frame.locator(".note .note-done").tap();
  await expect(frame.locator("body")).toHaveClass(/sheet/);
  await expect(frame.locator("body")).not.toHaveClass(/focus-mode/);
  await expect(frame.locator(".phrase", { hasText: "Another paragraph." })).toBeVisible();
  await expect(frame.locator("#collapse")).toBeVisible();

  // The next point opens without another fullscreen request.
  await frame.locator(".phrase", { hasText: "Another paragraph." }).tap();
  await expect(frame.locator("body")).toHaveClass(/focus-mode/);
  await expect(frame.locator(".note.active .note-quote")).toHaveText("Another paragraph.");
  await frame.locator(".note.active .note-done").tap();
  expect(await displayModes()).toEqual(["fullscreen"]);

  await frame.locator("#collapse").tap();
  await expect(frame.locator("body")).not.toHaveClass(/sheet|focus-mode/);
  await expect.poll(displayModes).toEqual(["fullscreen", "inline"]);
});

test("between notes in the sheet, Send stays on screen in a long response", async ({ page }) => {
  const markdown = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} has a sentence.`).join("\n\n");
  const frame = await mount(page, { allowFullscreen: true, args: { markdown } });
  await frame.locator(".phrase", { hasText: "Paragraph 1 has a sentence." }).tap();
  await frame.locator(".note textarea").fill("Why?");
  await frame.locator(".note .note-done").tap();
  await expect(frame.locator("body")).toHaveClass(/sheet/);
  await expect(frame.locator("#send")).toBeInViewport();
  await frame.locator(".phrase", { hasText: "Paragraph 20 has a sentence." }).scrollIntoViewIfNeeded();
  await expect(frame.locator("#send")).toBeInViewport();
  await expect(frame.locator(".phrase", { hasText: "Paragraph 1 has a sentence." })).not.toBeInViewport();
});

test("in the sheet, the arrows go from note to note", async ({ page }) => {
  const markdown = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} has a sentence.`).join("\n\n");
  const frame = await mount(page, { allowFullscreen: true, args: { markdown } });
  const note = (n: number) => frame.locator(".note", { hasText: `Paragraph ${n} has a sentence.` });
  for (const n of [5, 20, 39]) {
    await frame.locator(".phrase", { hasText: `Paragraph ${n} has a sentence.` }).tap();
    await frame.locator(".note.active .note-done").tap();
  }
  // Done on the last note leaves it in view: nothing after it.
  await expect(frame.locator("#next-note")).toBeDisabled();
  await frame.locator("#previous-note").tap();
  await expect(note(20)).toBeInViewport();
  // The note reached lights up for a moment.
  await expect(note(20)).toHaveClass(/arrived/);
  await expect(note(20)).not.toHaveClass(/arrived/);
  await frame.locator("#previous-note").tap();
  await expect(note(5)).toBeInViewport();
  await expect(frame.locator("#previous-note")).toBeDisabled();
  await frame.locator("#next-note").tap();
  await frame.locator("#next-note").tap();
  await expect(note(39)).toBeInViewport();
  await expect(frame.locator("#next-note")).toBeDisabled();
});

test("sending from the fullscreen sheet returns inline", async ({ page }) => {
  const frame = await mount(page, { allowFullscreen: true });
  await frame.locator(".phrase", { hasText: "First point here." }).tap();
  await frame.locator(".note textarea").fill("Why?");
  await frame.locator(".note .note-done").tap();
  await frame.locator("#send").tap();
  await expect(frame.locator("body")).not.toHaveClass(/sheet|focus-mode/);
  await expect.poll(async () => (await page.evaluate(() => window.recorded)).displayModes).toEqual(["fullscreen", "inline"]);
});

test("a touch selection offers Copy and Annotate below it, once it settles", async ({ page }) => {
  const frame = await mount(page);
  await frame.locator("#content").evaluate((content) => {
    const text = content.querySelector(".phrase")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, "First point".length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
  });
  const menu = frame.locator(".selection-menu");
  await expect(menu).toBeVisible();
  await expect(frame.locator(".note")).toHaveCount(0);
  const box = (await menu.boundingBox())!;
  const line = (await frame.locator(".phrase").first().boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(line.y + line.height);
  await frame.locator(".selection-annotate").tap();
  await expect(frame.locator(".note-quote")).toHaveText("First point");
  await expect(menu).toBeHidden();
});

test("typing in a note is not mistaken for a passage selection", async ({ page }) => {
  const frame = await mount(page);
  await frame.locator(".phrase", { hasText: "Second point here." }).tap();
  const field = frame.locator(".note textarea");
  await field.tap();
  await field.pressSequentially("hello world");
  // iOS reports selections while typing (autocorrect, word selection): simulate one in the field.
  await field.evaluate((element: HTMLTextAreaElement) => {
    element.setSelectionRange(0, 5);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.waitForTimeout(1300);
  await expect(frame.locator(".note")).toHaveCount(1);
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("hello world");
});

test("the fullscreen sheet keeps the note below the host title bar", async ({ page }) => {
  const frame = await mount(page, { allowFullscreen: true, context: { platform: "mobile" } });
  await frame.locator(".phrase", { hasText: "First point here." }).tap();
  await expect(frame.locator("body")).toHaveClass(/sheet/);
  const top = await frame.locator(".note.active").evaluate((note) => note.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(100);
});

test("outside Claude, the sheet keeps to the safe areas the host reports", async ({ page }) => {
  const frame = await mount(page, {
    allowFullscreen: true,
    hostName: "chatgpt",
    context: { platform: "mobile", safeAreaInsets: { top: 20, right: 0, bottom: 0, left: 0 } },
  });
  await frame.locator(".phrase", { hasText: "First point here." }).tap();
  await expect(frame.locator("body")).toHaveClass(/sheet/);
  const top = await frame.locator(".note.active").evaluate((note) => note.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(20);
  expect(top).toBeLessThan(100);
});

test("between notes, Send sits above the host's reply field", async ({ page }) => {
  const markdown = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} has a sentence.`).join("\n\n");
  const frame = await mount(page, { allowFullscreen: true, args: { markdown }, context: { platform: "mobile" } });
  await frame.locator(".phrase", { hasText: "Paragraph 1 has a sentence." }).tap();
  await frame.locator(".note textarea").fill("Why?");
  await frame.locator(".note .note-done").tap();
  await expect(frame.locator("#send")).toBeVisible();
  const gap = await frame.locator("#send").evaluate((send) => window.innerHeight - send.getBoundingClientRect().bottom);
  expect(gap).toBeGreaterThanOrEqual(150);
});
