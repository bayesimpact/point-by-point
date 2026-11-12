import { afterEach, describe, expect, it, vi } from "vitest";
import { writeClipboard } from "../src/clipboard";
import { clampToContent } from "../src/selection";

function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: writeText ? { writeText } : undefined });
}

describe("writeClipboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("writes through the clipboard API", async () => {
    const writeText = vi.fn(async () => {});
    setClipboard(writeText);
    expect(await writeClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("copies from a hidden field when the API refuses, and gives the focus and the selection back", async () => {
    setClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    const field = document.createElement("textarea");
    const text = document.createElement("p");
    text.textContent = "selected passage";
    document.body.append(field, text);
    field.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);

    let copiedValue = "";
    document.execCommand = vi.fn(() => {
      copiedValue = document.querySelector<HTMLTextAreaElement>("textarea[aria-hidden]")!.value;
      return true;
    });
    expect(await writeClipboard("fallback text")).toBe(true);
    expect(copiedValue).toBe("fallback text");
    expect(document.querySelectorAll("textarea")).toHaveLength(1);
    expect(document.activeElement).toBe(field);
    expect(getSelection()!.toString()).toBe("selected passage");
  });

  it("says so when nothing could copy", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn(() => false);
    expect(await writeClipboard("text")).toBe(false);
    document.execCommand = vi.fn(() => {
      throw new Error("blocked");
    });
    expect(await writeClipboard("text")).toBe(false);
  });
});

describe("clampToContent", () => {
  it("keeps the part of a selection that lies in the response", () => {
    document.body.innerHTML = '<p id="before">Before.</p><div id="content"><p>Inside the response.</p></div><p id="after">After.</p>';
    const content = document.querySelector<HTMLElement>("#content")!;
    const inside = content.querySelector("p")!.firstChild!;
    const range = document.createRange();

    range.setStart(inside, 7);
    range.setEnd(document.querySelector("#after")!.firstChild!, 3);
    expect(clampToContent(range, content)!.toString()).toBe("the response.");

    range.setStart(document.querySelector("#before")!.firstChild!, 2);
    range.setEnd(inside, 6);
    expect(clampToContent(range, content)!.toString()).toBe("Inside");

    range.setStart(inside, 0);
    range.setEnd(inside, 6);
    expect(clampToContent(range, content)!.toString()).toBe("Inside");

    range.selectNodeContents(document.querySelector("#after")!);
    expect(clampToContent(range, content)).toBeNull();
  });
});
