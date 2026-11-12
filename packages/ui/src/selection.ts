import { writeClipboard } from "./clipboard";
import type { Strings } from "./i18n";

export interface SelectionMenuOptions {
  /** The response: only selections inside it get the menu. */
  content: HTMLElement;
  /** False until the response is complete. */
  enabled(): boolean;
  isTouch(): boolean;
  labels(): Pick<Strings, "selectionMenu" | "selectionCopy" | "selectionCopied" | "selectionCopyFailed" | "selectionAnnotate">;
  /** False for a selection that holds nothing to annotate, such as code alone. */
  canAnnotate(range: Range): boolean;
  onAnnotate(range: Range): void;
}

export interface SelectionMenu {
  hide(): void;
  /** Applies the labels again, after a change of language. */
  relabel(): void;
}

/** True while the user types in a field: selections there belong to the field. */
function editingText(): boolean {
  const active = document.activeElement;
  return !!active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
}

function sameRange(a: Range, b: Range): boolean {
  return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
}

/**
 * The part of a range that lies inside `content`, or null when there is none. A drag can start or
 * end past the response, in the bar under it for example: the passage is what it covers of the response.
 */
export function clampToContent(range: Range, content: HTMLElement): Range | null {
  if (!range.intersectsNode(content)) return null;
  const clamped = range.cloneRange();
  if (!content.contains(clamped.startContainer)) clamped.setStart(content, 0);
  if (!content.contains(clamped.endContainer)) clamped.setEnd(content, content.childNodes.length);
  return clamped.collapsed ? null : clamped;
}

/** A selection offers two actions next to it: copy the passage, or annotate it. */
export function createSelectionMenu(options: SelectionMenuOptions): SelectionMenu {
  const { content } = options;
  const menu = document.createElement("div");
  menu.className = "selection-menu";
  menu.setAttribute("role", "toolbar");
  menu.hidden = true;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "selection-copy";
  const annotate = document.createElement("button");
  annotate.type = "button";
  annotate.className = "selection-annotate";
  menu.append(copy, annotate);
  document.body.append(menu);

  let menuRange: Range | null = null;
  let menuTimer: ReturnType<typeof setTimeout> | undefined;

  function relabel() {
    const s = options.labels();
    menu.setAttribute("aria-label", s.selectionMenu);
    if (!copy.dataset.state) copy.textContent = s.selectionCopy;
    annotate.textContent = s.selectionAnnotate;
  }

  /** The selection, kept to the response. */
  function selectedRange(): Range | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    return clampToContent(selection.getRangeAt(0), content);
  }

  /** The selected passage, when it is one the menu applies to: in the response, outside the notes. */
  function selectedPassage(): Range | null {
    if (editingText()) return null;
    const range = selectedRange();
    if (!range) return null;
    const inNote = (node: Node) => {
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      return !!element?.closest(".note");
    };
    if (inNote(range.startContainer) || inNote(range.endContainer)) return null;
    return range.toString().trim().length > 2 ? range : null;
  }

  function show(range: Range) {
    clearTimeout(menuTimer);
    menuRange = range.cloneRange();
    delete copy.dataset.state;
    relabel();
    annotate.hidden = !options.canAnnotate(range);
    menu.hidden = false;
    place(range);
  }

  function hide() {
    clearTimeout(menuTimer);
    menu.hidden = true;
    menuRange = null;
  }

  /**
   * Above the start of the selection with a mouse; below its end on touch, where the system's own
   * selection menu takes the space above.
   */
  function place(range: Range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 || rect.height > 0);
    const first = rects[0] ?? range.getBoundingClientRect();
    const last = rects.at(-1) ?? first;
    const box = menu.getBoundingClientRect();
    const gap = 8;
    const above = !options.isTouch() && first.top - box.height - gap >= 0;
    const anchor = above ? first : last;
    const top = above ? first.top - box.height - gap : last.bottom + gap;
    const width = document.documentElement.clientWidth;
    const center = anchor.left + anchor.width / 2;
    const left = Math.min(Math.max(center - box.width / 2, gap), Math.max(gap, width - box.width - gap));
    menu.style.top = `${top + window.scrollY}px`;
    menu.style.left = `${left + window.scrollX}px`;
  }

  /** The selected text as it reads on screen, line breaks included, without the notes it crosses. */
  function plainTextOf(range: Range): string {
    const holder = document.createElement("div");
    holder.className = "copy-holder";
    holder.append(range.cloneContents());
    for (const skipped of holder.querySelectorAll(".note-slot, .note, button")) skipped.remove();
    content.append(holder);
    const text = holder.innerText ?? holder.textContent ?? "";
    holder.remove();
    return text.trim();
  }

  // The menu keeps the selection: a press on it does not move the focus or the caret. A finger on it
  // can still clear the selection before the tap lands, so the menu stays while it is pressed.
  let pressingMenu = false;
  menu.addEventListener("mousedown", (event) => event.preventDefault());
  menu.addEventListener("pointerdown", () => {
    pressingMenu = true;
  });
  for (const type of ["click", "pointercancel"]) {
    menu.addEventListener(type, () => setTimeout(() => (pressingMenu = false), 0));
  }

  copy.addEventListener("click", async () => {
    const range = menuRange;
    if (!range) return;
    const copied = await writeClipboard(plainTextOf(range));
    const s = options.labels();
    copy.dataset.state = copied ? "copied" : "failed";
    copy.textContent = copied ? s.selectionCopied : s.selectionCopyFailed;
    clearTimeout(menuTimer);
    menuTimer = setTimeout(hide, 1200);
  });

  annotate.addEventListener("click", () => {
    const range = menuRange;
    hide();
    if (range) options.onAnnotate(range);
  });

  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    hide();
  });

  // A drag that starts in the response gets the menu wherever the button is released: under the last
  // line, in the bar below, outside the frame.
  let pressedInContent = false;
  const inResponse = (target: EventTarget | null) =>
    target instanceof Element && content.contains(target) && !target.closest(".note");
  document.addEventListener("mousedown", (event) => {
    pressedInContent = inResponse(event.target);
  });
  document.addEventListener("mouseup", (event) => {
    const fromContent = pressedInContent;
    pressedInContent = false;
    if (!options.enabled() || options.isTouch()) return;
    if (!fromContent && !inResponse(event.target)) return;
    if (event.target instanceof Element && event.target.closest(".note, .selection-menu")) return;
    setTimeout(() => {
      const range = selectedPassage();
      if (range) show(range);
    }, 0);
  });

  // A changed or cleared selection takes the menu away. On touch, the selection handles keep moving
  // after the finger lifts: the menu waits until the selection settles.
  let selectionTimer: ReturnType<typeof setTimeout> | undefined;
  document.addEventListener("selectionchange", () => {
    if (!options.enabled()) return;
    if (menuRange && !copy.dataset.state && !pressingMenu) {
      const current = selectedRange();
      if (!current || !sameRange(current, menuRange)) hide();
    }
    if (!options.isTouch()) return;
    clearTimeout(selectionTimer);
    if (editingText()) return;
    selectionTimer = setTimeout(() => {
      const range = selectedPassage();
      if (range && !(menuRange && sameRange(range, menuRange))) show(range);
    }, 900);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) hide();
  });
  window.addEventListener("resize", () => {
    if (menuRange) place(menuRange);
  });

  return { hide, relabel };
}
