import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import type { MountOptions } from "./harness/host";

const MARKDOWN = [
  "# Plan",
  "",
  "First we migrate the database. Then we switch traffic, see [the runbook](https://example.com/runbook).",
  "",
  "- Keep the old cluster for a week.",
  "- Watch the error rate.",
  "",
  "```sh",
  "npm run migrate",
  "```",
].join("\n");

async function mount(page: Page, options: Partial<MountOptions> = {}) {
  await page.goto("/");
  const opts = JSON.parse(JSON.stringify({ args: { markdown: MARKDOWN }, ...options })) as unknown;
  await page.evaluate((value) => window.mount(value as MountOptions), opts);
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator(".phrase").first()).toBeVisible();
  return frame;
}

const recorded = (page: Page) => page.evaluate(() => window.recorded);

/** Selects a passage and releases the mouse, as a drag over it does (the press leaves any note). */
async function select(frame: FrameLocator, passage: string) {
  await frame.locator("#content").evaluate((content, text) => {
    (document.activeElement as HTMLElement | null)?.blur();
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
  await expect(frame.locator(".selection-menu")).toBeVisible();
}

/** Selects a passage and chooses Annotate in the menu next to it. */
async function annotate(frame: FrameLocator, passage: string) {
  await select(frame, passage);
  await frame.locator(".selection-annotate").click();
  // The note opens, focused.
  await expect(frame.locator(".note textarea:focus")).toHaveCount(1);
}

/** How many passages carry the highlighter. */
const highlighted = (frame: FrameLocator) =>
  frame.locator("html").evaluate(() => CSS.highlights.get("pbp-selection")?.size ?? 0);

test("annotates selected passages, inserts them in document order, and keeps them", async ({ page }) => {
  const frame = await mount(page);
  await annotate(frame, "Watch the error rate.");
  await expect(frame.locator(".note textarea")).toBeFocused();
  await page.keyboard.type("Which dashboard?");

  await annotate(frame, "First we migrate the database.");
  await page.keyboard.type("Back up first.");
  await expect(frame.locator("#send")).toHaveText("Draft my reply");

  await frame.locator("#send").click();

  await expect(frame.locator("#status")).toHaveText("In your message box: read it, then send.");
  expect((await recorded(page)).messages).toEqual([
    "`First we migrate the database.` Back up first.\n\n`Watch the error rate.` Which dashboard?",
  ]);
  await expect(frame.locator(".note textarea").first()).toHaveValue("Back up first.");
  await expect(frame.locator(".note textarea").last()).toHaveValue("Which dashboard?");
  expect(await highlighted(frame)).toBe(2);
  await expect(frame.locator("#send")).toHaveText("Draft my reply");
});

test("in ChatGPT, the button sends", async ({ page }) => {
  const frame = await mount(page, { hostName: "chatgpt" });
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Which dashboard?");
  await expect(frame.locator("#send")).toHaveText("Send");
  await frame.locator("#send").click();
  await expect(frame.locator("#status")).toHaveText("Passed to the conversation");
  await expect(frame.locator(".note textarea")).toHaveValue("Which dashboard?");
});

test("has no general remark field: every note hangs on a passage", async ({ page }) => {
  const frame = await mount(page);
  await expect(frame.locator("#remark, .remark")).toHaveCount(0);
  await expect(frame.locator("#hint")).toHaveText("Select a passage to annotate it.");
});

test("the mouse proposes nothing: pointing at or clicking a sentence leaves it as it is", async ({ page }) => {
  const frame = await mount(page);
  const sentence = frame.locator(".phrase", { hasText: "Watch the error rate." });
  await sentence.hover();
  await expect(sentence).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(sentence).toHaveCSS("background-image", "none");
  await expect(sentence).toHaveCSS("transition-duration", "0s");
  await sentence.click();
  await expect(frame.locator(".note")).toHaveCount(0);
  expect(await highlighted(frame)).toBe(0);
});

test("a drag with the mouse annotates exactly the passage it covers", async ({ page }) => {
  const frame = await mount(page);
  const phrase = frame.locator(".phrase", { hasText: "switch traffic" });
  const span = (await phrase.boundingBox())!;
  const words = await phrase.evaluate((el) => {
    const text = el.firstChild as Text;
    const start = text.data.indexOf("switch traffic");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + "switch traffic".length);
    const box = range.getBoundingClientRect();
    const origin = el.getBoundingClientRect();
    return { left: box.left - origin.left, right: box.right - origin.left, middle: box.top - origin.top + box.height / 2 };
  });
  await page.mouse.move(span.x + words.left + 1, span.y + words.middle);
  await page.mouse.down();
  await page.mouse.move(span.x + words.right - 1, span.y + words.middle, { steps: 8 });
  await page.mouse.up();
  await expect(frame.locator(".selection-menu")).toBeVisible();
  await expect(frame.locator(".note")).toHaveCount(0);
  await frame.locator(".selection-annotate").click();
  await expect(frame.locator(".note-quote")).toHaveText("switch traffic");
  await expect(frame.locator(".note textarea")).toBeFocused();
  expect(await highlighted(frame)).toBe(1);
});

test("a drag released below the response still offers the menu, for the part inside the response", async ({ page }) => {
  const frame = await mount(page);
  const last = (await frame.locator("li").last().boundingBox())!;
  const hint = (await frame.locator("#hint").boundingBox())!;
  const words = await frame.locator("li").last().evaluate((item) => {
    const text = item.querySelector(".phrase")!.firstChild as Text;
    const range = document.createRange();
    range.setStart(text, "Watch ".length);
    range.setEnd(text, text.data.length);
    return range.getBoundingClientRect().left - item.getBoundingClientRect().left;
  });
  await page.mouse.move(last.x + words + 1, last.y + last.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 5 });
  await page.mouse.move(hint.x + hint.width / 2, hint.y + hint.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(frame.locator(".selection-menu")).toBeVisible();
  await frame.locator(".selection-annotate").click();
  await expect(frame.locator(".note-quote")).toHaveText("the error rate.");
});

test("a selection of code alone offers Copy, not Annotate", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await mount(page);
  await frame.locator("#content").evaluate((content) => {
    const range = document.createRange();
    range.selectNodeContents(content.querySelector("pre code")!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    content.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await expect(frame.locator(".selection-copy")).toBeVisible();
  await expect(frame.locator(".selection-annotate")).toBeHidden();
  await frame.locator(".selection-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm run migrate");
  // A passage of text brings Annotate back.
  await select(frame, "Watch the error rate.");
  await expect(frame.locator(".selection-annotate")).toBeVisible();
});

test("a selection offers Copy and Annotate, next to it", async ({ page }) => {
  const frame = await mount(page);
  await select(frame, "Watch the error rate.");
  const menu = frame.locator(".selection-menu");
  await expect(menu.locator("button")).toHaveText(["Copy", "Annotate"]);
  await expect(frame.locator(".note")).toHaveCount(0);
  const box = (await menu.boundingBox())!;
  const line = (await frame.locator(".phrase", { hasText: "Watch the error rate." }).boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(line.y);
});

test("Copy puts the selected text on the clipboard and keeps the selection", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await mount(page);
  await select(frame, "Keep the old cluster for a week.");
  await frame.locator(".selection-copy").click();
  await expect(frame.locator(".selection-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Keep the old cluster for a week.");
  await expect(frame.locator(".note")).toHaveCount(0);
  expect(await frame.locator("html").evaluate(() => getSelection()!.toString())).toBe("Keep the old cluster for a week.");
  await expect(frame.locator(".selection-menu")).toBeHidden();
});

test("Copy keeps the line breaks of a passage across blocks", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await mount(page);
  await frame.locator("#content").evaluate((content) => {
    const items = content.querySelectorAll("li");
    const range = document.createRange();
    range.setStart(items[0]!, 0);
    range.setEnd(items[1]!, items[1]!.childNodes.length);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    content.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await frame.locator(".selection-copy").click();
  await expect(frame.locator(".selection-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Keep the old cluster for a week.\nWatch the error rate.",
  );
});

test("the menu leaves with the selection, and with Escape", async ({ page }) => {
  const frame = await mount(page);
  await select(frame, "Watch the error rate.");
  await frame.locator("html").evaluate(() => getSelection()!.removeAllRanges());
  await expect(frame.locator(".selection-menu")).toBeHidden();
  await select(frame, "Watch the error rate.");
  await frame.locator(".selection-annotate").press("Escape");
  await expect(frame.locator(".selection-menu")).toBeHidden();
  await expect(frame.locator(".note")).toHaveCount(0);
});

test("selecting an annotated passage again returns to its note without a duplicate", async ({ page }) => {
  const frame = await mount(page);
  await annotate(frame, "Keep the old cluster");
  await page.keyboard.type("Why a week?");
  await annotate(frame, "Keep the old cluster");
  await expect(frame.locator(".note")).toHaveCount(1);
  await expect(frame.locator(".note textarea")).toBeFocused();
  expect(await highlighted(frame)).toBe(1);
});

test("annotates a free selection with its exact text", async ({ page }) => {
  const frame = await mount(page);
  await frame.locator("#content").evaluate((content) => {
    const text = Array.from(content.querySelectorAll(".phrase")).find((el) => el.textContent?.includes("switch traffic"))!
      .firstChild as Text;
    const start = text.data.indexOf("switch traffic");
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + "switch traffic".length);
    const selection = getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    content.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await frame.locator(".selection-annotate").click();
  await expect(frame.locator(".note-quote")).toHaveText("switch traffic");
  await page.keyboard.type("When?");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect.poll(async () => (await recorded(page)).messages).toEqual(["`switch traffic` When?"]);
});

test("a code block is copied, not annotated", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await mount(page);
  await expect(frame.locator("pre .phrase")).toHaveCount(0);
  await frame.locator("pre").click();
  await expect(frame.locator(".note")).toHaveCount(0);
  await frame.locator(".code-copy").click();
  await expect(frame.locator(".code-copy")).toHaveAttribute("data-state", "copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("npm run migrate");
});

test("a table cell's note goes under the table frame, and the markdown alignment holds", async ({ page }) => {
  const markdown = "| Service | Price |\n|---|--:|\n| Fly | 5 $ |\n| E2B | 150 $ |";
  const frame = await mount(page, { args: { markdown } });
  await expect(frame.locator("td", { hasText: "150 $" })).toHaveCSS("text-align", "end");
  await annotate(frame, "E2B");
  await expect(frame.locator(".table-wrap + .note-slot .note")).toHaveCount(1);
  await expect(frame.locator(".table-wrap .note")).toHaveCount(0);
});

test("Send stays hidden and the hint shown until a note has text", async ({ page }) => {
  const frame = await mount(page);
  await expect(frame.locator("#send")).toBeHidden();
  await expect(frame.locator("#hint")).toBeVisible();
  await annotate(frame, "Watch the error rate.");
  await expect(frame.locator("#send")).toBeHidden();
  await page.keyboard.type("Why?");
  await expect(frame.locator("#send")).toBeVisible();
  await expect(frame.locator("#send")).toBeEnabled();
  await expect(frame.locator("#hint")).toBeHidden();
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(frame.locator("#send")).toBeHidden();
  await expect(frame.locator("#hint")).toBeVisible();
  // Cmd/Ctrl+Enter sends nothing either.
  await page.keyboard.press("ControlOrMeta+Enter");
  expect((await recorded(page)).messages).toEqual([]);
});

test("links open through the host and do not open a note", async ({ page }) => {
  const frame = await mount(page);
  await frame.locator("a", { hasText: "the runbook" }).click();
  await expect.poll(async () => (await recorded(page)).links).toEqual(["https://example.com/runbook"]);
  await expect(frame.locator(".note")).toHaveCount(0);
});

test("a relative link or an anchor opens nothing", async ({ page }) => {
  const frame = await mount(page, { args: { markdown: "See [the page](/docs/page) and [the section](#section). Or [mail](mailto:a@example.com)." } });
  await frame.locator("a", { hasText: "the page" }).click();
  await frame.locator("a", { hasText: "the section" }).click();
  await frame.locator("a", { hasText: "mail" }).click();
  await expect.poll(async () => (await recorded(page)).links).toEqual(["mailto:a@example.com"]);
  expect(page.url()).not.toContain("#section");
});

test("a note opens a new conversation prefilled with its passage and its text", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await mount(page);
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Which dashboard?");
  const button = frame.locator(".note-newchat");
  await expect(button).toHaveAttribute("title", "New conversation about this passage");
  await button.click();

  await expect.poll(async () => (await recorded(page)).links.length).toBe(1);
  const [link] = (await recorded(page)).links;
  const url = new URL(link!);
  expect(`${url.origin}${url.pathname}`).toBe("https://claude.ai/new");
  expect(url.searchParams.get("q")).toBe("About this passage:\n\n> Watch the error rate.\n\nWhich dashboard?");
  // The text is also copied, for hosts that confirm the link and then open nothing (Claude Desktop).
  await expect(frame.locator("#error")).toHaveText("Also copied: if no conversation opened, start a new one and paste.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "About this passage:\n\n> Watch the error rate.\n\nWhich dashboard?",
  );
  // The note stays, and nothing is sent to the current conversation.
  await expect(frame.locator(".note textarea")).toHaveValue("Which dashboard?");
  expect((await recorded(page)).messages).toEqual([]);
});

test("in Claude Desktop, the new conversation button copies the text and opens no link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const frame = await mount(page, { context: { platform: "desktop" } });
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Which dashboard?");
  const button = frame.locator(".note-newchat");
  await expect(button).toHaveAttribute("title", "Copy for a new conversation about this passage");
  await button.click();

  await expect(frame.locator("#error")).toHaveText("Copied: start a new conversation and paste.");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "About this passage:\n\n> Watch the error rate.\n\nWhich dashboard?",
  );
  expect((await recorded(page)).links).toEqual([]);
});

test("removing a note clears the highlight", async ({ page }) => {
  const frame = await mount(page);
  await annotate(frame, "Watch the error rate.");
  expect(await highlighted(frame)).toBe(1);
  // Remove is the cross in the note's top right corner.
  const note = await frame.locator(".note").boundingBox();
  const cross = await frame.locator(".note-remove").boundingBox();
  expect(cross!.x + cross!.width).toBeGreaterThan(note!.x + note!.width - 16);
  expect(cross!.y).toBeLessThan(note!.y + 16);
  await frame.locator(".note-remove").click();
  await expect(frame.locator(".note")).toHaveCount(0);
  expect(await highlighted(frame)).toBe(0);
  await expect(frame.locator(".phrase", { hasText: "Watch the error rate." })).toBeFocused();
});

test("the quote never runs under the buttons in the note's corner", async ({ page }) => {
  const frame = await mount(page);
  await annotate(frame, "First we migrate the database.");
  const quote = await frame.locator(".note-quote").boundingBox();
  const newChat = await frame.locator(".note-newchat").boundingBox();
  expect(quote!.x + quote!.width).toBeLessThanOrEqual(newChat!.x);
});

test("works with the keyboard alone", async ({ page }) => {
  const frame = await mount(page);
  // One sentence is a tab stop; the arrow keys go from sentence to sentence.
  const stop = frame.locator(".phrase[tabindex='0']");
  await expect(stop).toHaveCount(1);
  await stop.focus();
  await expect(stop).toHaveAttribute("aria-label", "Annotate: Plan");
  await page.keyboard.press("ArrowDown");
  await expect(stop).toHaveCount(1);
  await expect(stop).toBeFocused();
  await expect(stop).toHaveAttribute("role", "button");
  await expect(stop).toHaveAttribute("aria-label", "Annotate: First we migrate the database.");
  await expect(frame.locator(".phrase[role='button']")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(frame.locator(".note textarea")).toBeFocused();
  await page.keyboard.type("ok");
  await page.keyboard.press("Escape");
  await expect(stop).toBeFocused();
  await expect(stop).toHaveAttribute("aria-label", "Edit annotation: First we migrate the database.");
  await page.keyboard.press("ArrowUp");
  await expect(stop).toHaveText("Plan");
  await expect(stop).toBeFocused();
  await page.keyboard.press("End");
  await expect(stop).toHaveText("Watch the error rate.");
  await page.keyboard.press("Home");
  await expect(stop).toHaveText("Plan");
  // Tab leaves the sentences for the next control: the link, then the note.
  await page.keyboard.press("Tab");
  await expect(frame.locator("a", { hasText: "the runbook" })).toBeFocused();
});

test("a response of any length has a single sentence in the tab order", async ({ page }) => {
  const markdown = Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of the response. And its follow-up.`).join("\n\n");
  const frame = await mount(page, { args: { markdown } });
  await expect(frame.locator(".phrase")).toHaveCount(120);
  await expect(frame.locator(".phrase[tabindex='0']")).toHaveCount(1);
  await expect(frame.locator(".phrase[role='button']")).toHaveCount(1);
});

test("restores drafts after a reload, also after sending", async ({ page }) => {
  // A host replays the stored tool result on a reload: the creation time is the same.
  let frame = await mount(page, { createdAt: 1000 });
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Draft reply");
  await page.waitForTimeout(400);

  frame = await mount(page, { createdAt: 1000 });
  await expect(frame.locator(".note textarea")).toHaveValue("Draft reply");
  await frame.locator("#send").click();
  await expect(frame.locator("#status")).toBeVisible();

  frame = await mount(page, { createdAt: 1000 });
  await expect(frame.locator(".note textarea")).toHaveValue("Draft reply");
});

test("two responses with the same text keep their own notes", async ({ page }) => {
  const frame = await mount(page, { args: { markdown: "Done. Anything else?" }, createdAt: 1000 });
  await annotate(frame, "Anything else?");
  await page.keyboard.type("Yes, one thing.");
  await page.waitForTimeout(400);
  await page.evaluate(() => window.mount({ args: { markdown: "Done. Anything else?" }, createdAt: 2000 }));
  const second = page.frameLocator("iframe[data-index='1']");
  await expect(second.locator(".phrase").first()).toBeVisible();
  await expect(second.locator("#hint")).toBeVisible();
  await expect(second.locator(".note")).toHaveCount(0);
  await expect(second.locator("#send")).toBeHidden();
  await expect(frame.locator(".note textarea")).toHaveValue("Yes, one thing.");
});

test("notes saved by an earlier release, under the text alone, are adopted", async ({ page }) => {
  await page.goto("/");
  // FNV-1a of the response text, as hashText computes it.
  await page.evaluate((markdown) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < markdown.length; i++) hash = Math.imul(hash ^ markdown.charCodeAt(i), 0x01000193);
    const annotations = [{ kind: "sentence", sentence: 2, start: 0, end: 0, quote: "Watch the error rate.", text: "From 0.34" }];
    localStorage.setItem(`point-by-point:draft:${(hash >>> 0).toString(36)}`, JSON.stringify({ annotations }));
  }, MARKDOWN);
  await page.evaluate((markdown) => window.mount({ args: { markdown }, createdAt: 1000 }), MARKDOWN);
  const frame = page.frameLocator("iframe").first();
  // The saved sentence number no longer matches (it was another sentence): the note follows its quote.
  await expect(frame.locator(".note textarea")).toHaveValue("From 0.34");
  await expect(frame.locator(".note-quote")).toHaveText("Watch the error rate.");
  await expect(frame.locator(".phrase.annotated")).toHaveText("Watch the error rate.");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes(":draft:")));
  expect(keys).toHaveLength(1);
  expect(keys[0]).toMatch(/:1000$/);
});

test("a note whose passage moved is shown where its quote reads", async ({ page }) => {
  const frame = await mount(page, { createdAt: 1000 });
  await annotate(frame, "switch traffic");
  await page.keyboard.type("When?");
  await page.waitForTimeout(400);
  // As if another release had counted the positions differently.
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.includes(":draft:"))!;
    const draft = JSON.parse(localStorage.getItem(key)!);
    draft.annotations[0].start += 7;
    draft.annotations[0].end += 7;
    localStorage.setItem(key, JSON.stringify(draft));
  });
  const reloaded = await mount(page, { createdAt: 1000 });
  await expect(reloaded.locator(".note-quote")).toHaveText("switch traffic");
  await expect(reloaded.locator(".note textarea")).toHaveValue("When?");
  expect(await reloaded.locator("html").evaluate(() => [...CSS.highlights.get("pbp-selection")!].map(String))).toEqual([
    "switch traffic",
  ]);
});

test("an earlier widget adds a context line", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async (markdown) => {
    await window.mount({ args: { markdown }, createdAt: 1000 });
    await window.mount({ args: { markdown: "A newer response." }, createdAt: 2000 });
  }, MARKDOWN);
  const older = page.frameLocator("iframe[data-index='0']");
  const newer = page.frameLocator("iframe[data-index='1']");
  await expect(newer.locator(".phrase").first()).toBeVisible();
  await annotate(older, "Watch the error rate.");
  await page.keyboard.type("Still relevant?");
  await older.locator("#send").click();
  await annotate(newer, "A newer response.");
  await page.keyboard.type("Fine.");
  await newer.locator("#send").click();
  await expect.poll(async () => (await recorded(page)).messages).toEqual([
    "(About an earlier response)\n\n`Watch the error rate.` Still relevant?",
    "`A newer response.` Fine.",
  ]);
});

test("a newer response in another tab, another conversation, adds no context line", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate((markdown) => window.mount({ args: { markdown }, createdAt: 1000 }), MARKDOWN);
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator(".phrase").first()).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await other.evaluate(() => window.mount({ args: { markdown: "Another conversation." }, createdAt: 2000 }));
  await expect(other.frameLocator("iframe").first().locator(".phrase").first()).toBeVisible();
  await page.bringToFront();
  await page.waitForTimeout(300);
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Still relevant?");
  await frame.locator("#send").click();
  await expect.poll(async () => (await recorded(page)).messages).toEqual(["`Watch the error rate.` Still relevant?"]);
});

test("offers a copy fallback when sending fails", async ({ page }) => {
  const frame = await mount(page, { failMessages: true });
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Hello");
  await frame.locator("#send").click();
  await expect(frame.locator("#error")).toBeVisible();
  await expect(frame.locator("#fallback-text")).toHaveValue("`Watch the error rate.` Hello");
  await expect(frame.locator("#copy")).toBeVisible();
});

test("speaks French when the host does", async ({ page }) => {
  const frame = await mount(page, { context: { locale: "fr-FR" } });
  await select(frame, "Watch the error rate.");
  await expect(frame.locator(".selection-menu button")).toHaveText(["Copier", "Annoter"]);
  await frame.locator(".selection-annotate").click();
  await expect(frame.locator(".note textarea")).toHaveAttribute("placeholder", "Ta réponse ou ta question");
  await expect(frame.locator(".note-remove")).toHaveText("Retirer");
  await expect(frame.locator(".note-remove")).toHaveAttribute("title", "Retirer");
  await expect(frame.locator(".note-done")).toHaveText("Valider");
  await page.keyboard.type("Pourquoi ?");
  await expect(frame.locator("#send")).toHaveText("Préparer ma réponse");
  await annotate(frame, "Keep the old cluster");
  await page.keyboard.type("Combien ?");
  await expect(frame.locator("#send")).toHaveText("Préparer ma réponse");
});

test("renders streamed input and enables annotation only at the end", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() =>
    window.mount({ args: { markdown: "One. Two." }, partials: [{ markdown: "On" }, { markdown: "One. T" }] }),
  );
  const frame = page.frameLocator("iframe").first();
  await expect(frame.locator(".phrase")).toHaveCount(2);
  await expect(frame.locator("#content")).not.toHaveClass(/streaming/);
});

test("follows the dark theme and keeps fields at 16px", async ({ page }) => {
  const frame = await mount(page, { context: { theme: "dark" } });
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");
  await annotate(frame, "Watch the error rate.");
  const size = await frame.locator(".note textarea").evaluate((el) => getComputedStyle(el).fontSize);
  expect(parseFloat(size)).toBeGreaterThanOrEqual(16);
});

test("fits a 360px wide container without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 376, height: 800 });
  const frame = await mount(page);
  const overflow = await frame.locator("html").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("keeps the copy fallback hidden until a send fails", async ({ page }) => {
  const frame = await mount(page);
  await expect(frame.locator("#fallback")).toBeHidden();
  await expect(frame.locator("#error")).toBeHidden();
  await expect(frame.locator("#storage-notice")).toBeHidden();
});

for (const [name, markdown] of [
  ["a response", MARKDOWN],
  ["the diagnostic", "/point-by-point-diagnostic"],
] as const) {
  test(`the frame height settles for ${name}`, async ({ page }) => {
    await page.goto("/");
    await page.evaluate((md) => window.mount({ args: { markdown: md } }), markdown);
    const height = () => page.locator("iframe").first().evaluate((frame) => frame.getBoundingClientRect().height);
    await page.waitForTimeout(600);
    const settled = await height();
    await page.waitForTimeout(1200);
    expect(await height()).toBe(settled);
    expect(settled).toBeLessThan(2000);
  });
}

test("the diagnostic sends a fresh report", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.mount({ args: { markdown: "/point-by-point-diagnostic" }, allowFullscreen: true }));
  const frame = page.frameLocator("iframe").first();
  await frame.getByRole("button", { name: "Request fullscreen" }).click();
  await expect(frame.locator(".diagnostic-output")).toContainText('"mode":"fullscreen"');
  await frame.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => (await page.evaluate(() => window.recorded)).messages.length).toBe(1);
  const [report] = (await page.evaluate(() => window.recorded)).messages;
  expect(report).toMatch(/^Point-by-point diagnostic\n\n```json\n/);
  expect(report).toMatch(/"minHeight": \d+/);
  expect(report).toContain('"availableDisplayModes": [\n    "inline",\n    "fullscreen"\n  ]');
});

test("after a send, a changed note clears the status and the button sends again", async ({ page }) => {
  const frame = await mount(page);
  await annotate(frame, "Watch the error rate.");
  await page.keyboard.type("Which dashboard?");
  await frame.locator("#send").click();
  await expect(frame.locator("#status")).toBeVisible();
  await expect(frame.getByRole("button", { name: "Restore notes" })).toHaveCount(0);

  await frame.locator(".note textarea").fill("Which dashboard? The new one?");
  await expect(frame.locator("#status")).toBeHidden();
  await frame.locator("#send").click();
  await expect.poll(async () => (await recorded(page)).messages).toEqual([
    "`Watch the error rate.` Which dashboard?",
    "`Watch the error rate.` Which dashboard? The new one?",
  ]);
});

for (const args of [
  { markdown: "/point-by-point-diagnostic", title: "Diagnostic" },
  { markdown: "`/point-by-point-diagnostic`" },
]) {
  test(`opens the diagnostic for ${JSON.stringify(args)}`, async ({ page }) => {
    await page.goto("/");
    await page.evaluate((value) => window.mount({ args: value }), args);
    const frame = page.frameLocator("iframe").first();
    await expect(frame.locator(".diagnostic-output")).toBeVisible();
    await expect(frame.locator("#composer")).toBeHidden();
  });
}
