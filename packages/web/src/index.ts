import "./styles.css";
import { compose, normalizeSpaces } from "../../ui/src/compose";
import { splitSentences } from "../../ui/src/segment";
import { buildIndex, find, occurrenceOf, offsetOf, rangeOf, type TextIndex } from "./textindex";
import { hitPage, loadPage, type Box } from "./pagetext";

/**
 * Point by point on any web page (`@point-by-point/web`). The MCP App annotates a response inside a
 * conversation; this mode annotates a page someone is reading, a report or a document, and hands the
 * notes back as one message in the same format:
 *
 *     `the quoted sentence` the note
 *
 * Comments are pins, as in a design tool: a click drops a numbered pin on the sentence under the
 * pointer (or on a selected passage, widened to whole words), the passage is highlighted without
 * touching the page's markup, and the note is written in a small card beside the pin. Nothing is
 * inserted into the page's flow, so a table or a grid keeps its layout.
 *
 * A pin lives in the nearest scrolling box of what it marks, so it scrolls with it: a page image in
 * a document viewer that scrolls on its own keeps its pins on the right line.
 *
 * Page images (a PDF rendered as one image per page) get the same treatment when the site says which
 * images are pages and where each page's text is (see pagetext.ts): a click quotes the sentence under
 * the pointer. Without the text, the pin still sits where the reader clicked, and the quote names the
 * page.
 *
 * Where the message goes is the site's business: a `send` function (an endpoint of its own), an
 * e-mail (`mailto`), and always a copy to the clipboard.
 */

export interface PageImage {
  /** What the reader calls the document, a file name for instance. */
  label: string;
  /** Its page number, from 1. */
  page: number;
  /** The address of the page's text (pagetext.ts), if there is one. */
  text?: string;
}

export interface Words {
  open: string;
  done: string;
  hint: string;
  placeholder: string;
  ok: string;
  remove: string;
  copy: string;
  copied: string;
  mail: string;
  send: string;
  sending: string;
  sent: string;
  failed: (reason: string) => string;
  count: (n: number) => string;
  pending: (n: number) => string;
  subject: (title: string) => string;
  head: (title: string, url: string) => string;
  page: (label: string, page: number, quote?: string) => string;
  tooLong: string;
}

export const WORDS: Record<"fr" | "en", Words> = {
  fr: {
    open: "Commenter",
    done: "Terminer",
    hint: "Cliquez une phrase ou sélectionnez un passage pour y laisser une remarque.",
    placeholder: "Votre remarque",
    ok: "OK",
    remove: "Supprimer",
    copy: "Copier",
    copied: "Copié",
    mail: "Envoyer par e-mail",
    send: "Envoyer",
    sending: "Envoi…",
    sent: "Envoyé, merci",
    failed: (r) => `Non envoyé (${r})`,
    count: (n) => (n ? `${n} remarque${n > 1 ? "s" : ""}` : "Aucune remarque"),
    pending: (n) => `${n} remarque${n > 1 ? "s" : ""} à envoyer`,
    subject: (t) => `Retours sur « ${t} »`,
    head: (t, u) => `Retours sur « ${t} » (${u}) :`,
    page: (l, p, q) => `${l}, page ${p}${q ? ` : ${q}` : ""}`,
    tooLong: "Le retour, point par point, est dans votre presse-papier : collez-le ici.",
  },
  en: {
    open: "Comment",
    done: "Done",
    hint: "Click a sentence or select a passage to leave a note on it.",
    placeholder: "Your note",
    ok: "OK",
    remove: "Delete",
    copy: "Copy",
    copied: "Copied",
    mail: "Send by e-mail",
    send: "Send",
    sending: "Sending…",
    sent: "Sent, thank you",
    failed: (r) => `Not sent (${r})`,
    count: (n) => (n ? `${n} note${n > 1 ? "s" : ""}` : "No notes"),
    pending: (n) => `${n} note${n > 1 ? "s" : ""} to send`,
    subject: (t) => `Feedback on "${t}"`,
    head: (t, u) => `Feedback on "${t}" (${u}):`,
    page: (l, p, q) => `${l}, page ${p}${q ? `: ${q}` : ""}`,
    tooLong: "The feedback, point by point, is on your clipboard: paste it here.",
  },
};

export interface PinsOptions {
  /** The element holding the text that can be annotated, or a function finding it (default <main>). */
  root?: Element | (() => Element | null);
  /** The page's current language (default <html lang>); notes are kept per language. */
  lang?: () => string;
  /** The page's title, for the message's first line and the e-mail subject. */
  title?: () => string;
  /** Overrides of the interface's words, per language. */
  words?: Partial<Record<string, Partial<Words>>>;
  /** Which images are pages of a document, and what each one is. */
  pages?: { selector: string; describe: (img: HTMLImageElement) => PageImage | null };
  /** Send the message somewhere; resolves when it has arrived, rejects with the reason otherwise. */
  send?: (message: string) => Promise<void>;
  /** Or open an e-mail with the message. */
  mailto?: { to: string; cc?: string };
  /** 'bubble' (default) shows a floating button; 'none' leaves it to the site, which calls start(). */
  launcher?: "bubble" | "none";
  /** Where the drafts are kept in the browser (default: one key per page address). */
  storageKey?: string;
}

export interface Pins {
  start(): void;
  stop(): void;
  toggle(): void;
  readonly active: boolean;
  count(): number;
  message(): string;
  destroy(): void;
}

type Anchor =
  | { kind: "text"; quote: string; nth: number }
  | { kind: "image"; label: string; page: number; x: number; y: number; boxes: Box[] };

interface Note {
  id: string;
  lang: string;
  /** What the message quotes. */
  quote: string;
  text: string;
  at: Anchor;
  created: number;
}

interface Placed {
  note: Note;
  pin: HTMLButtonElement;
  boxes: HTMLElement[];
  range: Range | null;
  /** The element or range that orders it in the page, and its place inside. */
  order: { node: Node; sub: number } | null;
}

const TEXT_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote, figcaption, summary";
const WORD = /[\p{L}\p{N}'’\-]/u;
/** A sentence shorter than this ("IV.", "1.") goes with the next one. */
const SHORT = 12;
/** Some mail apps cut a longer link. */
const MAILTO_MAX = 1800;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  e.dataset.pbpUi = "";
  return e;
};

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p && { node: p.offsetNode, offset: p.offset };
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

/** The nearest ancestor that scrolls, which a pin must live in to move with what it marks. */
function scroller(node: Node): HTMLElement | null {
  for (let e = node.nodeType === 1 ? (node as Element) : node.parentElement; e && e !== document.body; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (e.scrollHeight > e.clientHeight || e.scrollWidth > e.clientWidth)) {
      return e as HTMLElement;
    }
  }
  return null;
}

/** Widens a selection to whole words. */
function toWords(range: Range): Range {
  const r = range.cloneRange();
  if (r.startContainer.nodeType === 3) {
    const t = r.startContainer as Text;
    let i = r.startOffset;
    while (i > 0 && WORD.test(t.data[i - 1]!)) i--;
    r.setStart(t, i);
  }
  if (r.endContainer.nodeType === 3) {
    const t = r.endContainer as Text;
    let i = r.endOffset;
    while (i < t.data.length && WORD.test(t.data[i]!)) i++;
    r.setEnd(t, i);
  }
  return r;
}

const highlights = () => (globalThis.CSS && "highlights" in CSS ? CSS.highlights : null);

export function mountPins(options: PinsOptions = {}): Pins {
  const rootOf = () =>
    (typeof options.root === "function" ? options.root() : options.root) ?? document.querySelector("main") ?? document.body;
  const lang = () => (options.lang?.() || document.documentElement.lang || "fr").slice(0, 2);
  const w = (): Words => {
    const l = lang();
    return { ...(WORDS[l as "fr" | "en"] ?? WORDS.en), ...(options.words?.[l] ?? {}) } as Words;
  };
  const title = () => options.title?.() || document.title;
  const key = options.storageKey ?? `point-by-point:${location.pathname}`;

  let notes: Note[] = [];
  try {
    notes = JSON.parse(localStorage.getItem(key) || "[]") as Note[];
  } catch {
    notes = [];
  }
  const save = () => {
    try {
      const kept = notes.filter((n) => n.text.trim());
      if (kept.length) localStorage.setItem(key, JSON.stringify(kept));
      else localStorage.removeItem(key);
    } catch {
      /* private browsing */
    }
  };
  const mine = () => notes.filter((n) => n.lang === lang());

  let active = false;
  let index: TextIndex | null = null;
  const indexed = () => (index ??= buildIndex(rootOf()));

  // ---- the layer that holds pins outside any scrolling box
  const layer = el("div", "pbp-layer");
  document.body.append(layer);

  // ---- the toolbar and the floating button, bottom right
  const bar = el("div", "pbp-bar");
  bar.setAttribute("role", "region");
  const hint = el("p", "pbp-hint");
  const row = el("div", "pbp-row");
  const count = el("span", "pbp-count");
  const copyBtn = el("button", "pbp-btn");
  const mailLink = options.mailto ? el("a", "pbp-btn pbp-primary") : null;
  const sendBtn = options.send ? el("button", "pbp-btn pbp-primary") : null;
  const doneBtn = el("button", "pbp-btn pbp-done");
  for (const b of [copyBtn, sendBtn, doneBtn]) b?.setAttribute("type", "button");
  row.append(count, copyBtn, ...(sendBtn ? [sendBtn] : mailLink ? [mailLink] : []), doneBtn);
  bar.append(hint, row);
  const bubble = options.launcher === "none" ? null : el("button", "pbp-bubble");
  bubble?.setAttribute("type", "button");
  document.body.append(bar, ...(bubble ? [bubble] : []));

  // ---- the card where a note is written, beside its pin
  const pop = el("div", "pbp-pop");
  pop.setAttribute("role", "dialog");
  const popQuote = el("blockquote", "pbp-pop-quote");
  const popText = el("textarea", "pbp-pop-text");
  popText.rows = 3;
  const popRemove = el("button", "pbp-link");
  const popOk = el("button", "pbp-btn pbp-primary");
  popRemove.type = popOk.type = "button";
  const popFoot = el("div", "pbp-pop-foot");
  popFoot.append(popRemove, popOk);
  pop.append(popQuote, popText, popFoot);
  document.body.append(pop);

  const placed = new Map<string, Placed>();
  let openId: string | null = null;

  const message = () => {
    const live = mine().filter((n) => n.text.trim());
    if (!live.length) return "";
    // Page order, from the live page; notes whose passage is gone go last, oldest first.
    const ordered = live
      .map((n) => ({ n, o: placed.get(n.id)?.order ?? null }))
      .sort((a, b) => {
        if (!a.o || !b.o) return a.o ? -1 : b.o ? 1 : a.n.created - b.n.created;
        if (a.o.node === b.o.node) return a.o.sub - b.o.sub;
        return a.o.node.compareDocumentPosition(b.o.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });
    return compose(
      ordered.map(({ n }, i) => ({ quote: n.quote, text: n.text, order: i })),
      { contextLine: w().head(title(), location.href.split("#")[0]!) },
    );
  };

  // ---- placing pins
  /** A point of the page, in the coordinates of the box that will hold its pin. */
  const position = (host: HTMLElement, x: number, y: number) => {
    const r = host.getBoundingClientRect();
    if (host === layer) return { left: x - r.left, top: y - r.top };
    return { left: x - r.left - host.clientLeft + host.scrollLeft, top: y - r.top - host.clientTop + host.scrollTop };
  };
  const hostFor = (node: Node) => {
    const s = scroller(node);
    if (!s) return layer;
    if (getComputedStyle(s).position === "static") s.style.position = "relative";
    return s;
  };

  const imageFor = (a: Extract<Anchor, { kind: "image" }>) => {
    if (!options.pages) return null;
    for (const img of rootOf().querySelectorAll<HTMLImageElement>(options.pages.selector)) {
      if (!img.getClientRects().length) continue;
      const d = options.pages.describe(img);
      if (d && d.label === a.label && d.page === a.page) return img;
    }
    return null;
  };

  const layout = () => {
    index = null;
    const ranges: Range[] = [];
    let n = 0;
    const live = new Set<string>();
    for (const note of mine()) {
      live.add(note.id);
      let p = placed.get(note.id);
      if (!p) {
        const pin = el("button", "pbp-pin");
        pin.type = "button";
        pin.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openNote(note.id);
        });
        p = { note, pin, boxes: [], range: null, order: null };
        placed.set(note.id, p);
      }
      p.boxes.forEach((b) => b.remove());
      p.boxes = [];
      p.range = null;
      p.order = null;
      let host: HTMLElement | null = null;
      let point: { x: number; y: number } | null = null;
      const a = note.at;
      if (a.kind === "text") {
        const range = find(indexed(), a.quote, a.nth);
        const rects = range ? [...range.getClientRects()].filter((r) => r.width > 0) : [];
        if (range && rects.length) {
          const last = rects.at(-1)!;
          p.range = range;
          p.order = { node: range.startContainer, sub: range.startOffset };
          host = hostFor(range.startContainer);
          point = { x: last.right, y: last.top };
          ranges.push(range);
        }
      } else {
        const img = imageFor(a);
        if (img) {
          const r = img.getBoundingClientRect();
          host = hostFor(img);
          point = { x: r.left + a.x * r.width, y: r.top + a.y * r.height };
          p.order = { node: img, sub: a.y };
          for (const b of a.boxes) {
            const box = el("div", "pbp-box");
            const at = position(host, r.left + b[0] * r.width - 2, r.top + b[1] * r.height - 1);
            Object.assign(box.style, {
              left: `${at.left}px`,
              top: `${at.top}px`,
              width: `${(b[2] - b[0]) * r.width + 4}px`,
              height: `${(b[3] - b[1]) * r.height + 2}px`,
            });
            box.classList.toggle("is-open", openId === note.id);
            host.append(box);
            p.boxes.push(box);
          }
        }
      }
      if (host && point) {
        const at = position(host, point.x, point.y);
        p.pin.style.left = `${at.left}px`;
        p.pin.style.top = `${at.top}px`;
        p.pin.textContent = String(++n);
        p.pin.classList.toggle("is-open", openId === note.id);
        p.pin.classList.toggle("is-empty", !note.text.trim());
        p.pin.setAttribute("aria-label", `${n}. ${note.quote}`);
        if (p.pin.parentElement !== host) host.append(p.pin);
      } else p.pin.remove();
    }
    for (const [id, p] of placed) {
      if (!live.has(id)) {
        p.pin.remove();
        p.boxes.forEach((b) => b.remove());
        placed.delete(id);
      }
    }
    const hl = highlights();
    if (hl) {
      const open = openId ? placed.get(openId)?.range : null;
      hl.set("pbp-note", new Highlight(...ranges.filter((r) => r !== open)));
      if (open) hl.set("pbp-open", new Highlight(open));
      else hl.delete("pbp-open");
    }
    if (openId) placePop();
    refresh();
  };

  // ---- the card
  const placePop = () => {
    const p = openId ? placed.get(openId) : null;
    if (!p || !p.pin.isConnected) return closeNote();
    // Under the line the pin marks, so the card never hides the passage; above it when there is no room.
    const r = p.pin.getBoundingClientRect();
    const marks = p.range ? [...p.range.getClientRects()] : p.boxes.map((b) => b.getBoundingClientRect());
    const below = marks.length ? Math.max(...marks.map((x) => x.bottom)) : r.bottom + 24;
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    const left = Math.min(Math.max(12, r.left - 24), innerWidth - pw - 12);
    let top = below + 8;
    if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 8);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  function openNote(id: string) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    if (openId && openId !== id) closeNote();
    openId = id;
    popQuote.textContent = note.quote;
    popText.placeholder = w().placeholder;
    popOk.textContent = w().ok;
    popRemove.textContent = w().remove;
    popText.value = note.text;
    pop.classList.add("is-open");
    layout();
    popText.focus();
  }
  function closeNote() {
    if (!openId) return;
    const note = notes.find((n) => n.id === openId);
    openId = null;
    pop.classList.remove("is-open");
    // A pin left without a note is a click that changed its mind.
    if (note && !note.text.trim()) notes = notes.filter((n) => n !== note);
    save();
    layout();
  }
  popText.addEventListener("input", () => {
    const note = notes.find((n) => n.id === openId);
    if (!note) return;
    note.text = popText.value;
    save();
    placed.get(note.id)?.pin.classList.toggle("is-empty", !note.text.trim());
    refresh();
  });
  popText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) closeNote();
  });
  popOk.addEventListener("click", () => closeNote());
  popRemove.addEventListener("click", () => {
    notes = notes.filter((n) => n.id !== openId);
    openId = null;
    pop.classList.remove("is-open");
    save();
    layout();
  });

  const add = (quote: string, at: Anchor) => {
    const note: Note = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      lang: lang(),
      quote: normalizeSpaces(quote),
      text: "",
      at,
      created: Date.now(),
    };
    notes.push(note);
    openNote(note.id);
  };

  // ---- what a click or a selection points at
  const sentenceAt = (x: number, y: number): Range | null => {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== 3) return null;
    const block = caret.node.parentElement?.closest(TEXT_BLOCKS);
    if (!block || !rootOf().contains(block) || block.closest("[data-pbp-ui]")) return null;
    const idx = indexed();
    const from = offsetOf(idx, block, 0);
    const to = offsetOf(idx, block, block.childNodes.length);
    const at = offsetOf(idx, caret.node, caret.offset);
    if (from < 0 || at < 0) return null;
    const text = idx.text.slice(from, to < 0 ? undefined : to);
    const ranges = splitSentences(text, lang()).filter((r) => text.slice(r.start, r.end).trim());
    for (let i = 0; i < ranges.length - 1; i++) {
      if (text.slice(ranges[i]!.start, ranges[i]!.end).trim().length < SHORT) {
        ranges[i + 1] = { start: ranges[i]!.start, end: ranges[i + 1]!.end };
        ranges.splice(i--, 1);
      }
    }
    const s = ranges.find((r) => at - from >= r.start && at - from < r.end);
    if (!s) return null;
    const lead = text.slice(s.start, s.end).length - text.slice(s.start, s.end).trimStart().length;
    const trail = text.slice(s.start, s.end).length - text.slice(s.start, s.end).trimEnd().length;
    return rangeOf(idx, from + s.start + lead, from + s.end - trail);
  };

  const pageAt = async (img: HTMLImageElement, x: number, y: number) => {
    const d = options.pages?.describe(img);
    if (!d) return;
    const r = img.getBoundingClientRect();
    const fx = (x - r.left) / r.width;
    const fy = (y - r.top) / r.height;
    const hit = hitPage((await loadPage(d.text)) ?? { blocks: [] }, fx, fy, lang());
    add(w().page(d.label, d.page, hit?.quote), {
      kind: "image",
      label: d.label,
      page: d.page,
      x: hit ? (hit.boxes.at(-1)?.[2] ?? fx) : fx,
      y: hit ? (hit.boxes.at(-1)?.[1] ?? fy) : fy,
      boxes: hit?.boxes ?? [],
    });
  };

  let selectedAt = 0;
  const ours = (t: EventTarget | null) => t instanceof Element && !!t.closest("[data-pbp-ui]");

  const onClick = (e: MouseEvent) => {
    if (!active || ours(e.target) || !(e.target instanceof Element)) return;
    if (!rootOf().contains(e.target)) return;
    // The click that ends a selection: mouseup has made the note already.
    if (Date.now() - selectedAt < 400) return;
    e.preventDefault();
    e.stopPropagation();
    const img = options.pages && e.target.closest<HTMLImageElement>(options.pages.selector);
    if (img) return void pageAt(img, e.clientX, e.clientY);
    const range = sentenceAt(e.clientX, e.clientY);
    if (!range) return closeNote();
    const { quote, nth } = occurrenceOf(indexed(), range);
    if (quote) add(quote, { kind: "text", quote, nth });
  };
  const onMouseUp = (e: MouseEvent) => {
    if (!active || ours(e.target)) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = toWords(sel.getRangeAt(0));
    if (!rootOf().contains(range.commonAncestorContainer)) return;
    const { quote, nth } = occurrenceOf(indexed(), range);
    if (quote.length < 3) return;
    sel.removeAllRanges();
    selectedAt = Date.now();
    add(quote, { kind: "text", quote, nth });
  };
  // What a click would annotate, highlighted under the pointer.
  let hoverFrame = 0;
  const onMove = (e: MouseEvent) => {
    if (!active || hoverFrame) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = 0;
      const hl = highlights();
      if (!hl) return;
      const t = e.target instanceof Element ? e.target : null;
      const range = t && !ours(t) && !t.closest("img") && rootOf().contains(t) ? sentenceAt(e.clientX, e.clientY) : null;
      if (range) hl.set("pbp-hover", new Highlight(range));
      else hl.delete("pbp-hover");
    });
  };
  const onDocDown = (e: PointerEvent) => {
    if (openId && !ours(e.target) && !(e.target instanceof Element && e.target.closest(".pbp-pin"))) {
      // A click elsewhere closes the card; in comment mode, that click may also drop the next pin.
      closeNote();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (openId) closeNote();
    else if (active) stop();
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("mouseup", onMouseUp);
  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("keydown", onKey);

  // ---- keeping pins on their passage
  let frame = 0;
  const relayout = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      layout();
    });
  };
  addEventListener("resize", relayout);
  const onScroll = () => {
    if (openId) placePop();
  };
  addEventListener("scroll", onScroll, true);
  const ro = new ResizeObserver(relayout);
  ro.observe(document.body);
  const onLoad = (e: Event) => {
    if (e.target instanceof HTMLImageElement) relayout();
  };
  document.addEventListener("load", onLoad, true);
  const mo = new MutationObserver(relayout);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "data-lang"] });
  void document.fonts?.ready.then(relayout);

  // ---- the toolbar
  let flashTimer = 0;
  const flash = (b: HTMLElement, text: string, ms = 1800) => {
    b.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(refresh, ms);
  };
  function refresh() {
    const words = w();
    const n = mine().filter((x) => x.text.trim()).length;
    document.documentElement.classList.toggle("pbp-on", active);
    bar.classList.toggle("is-on", active);
    bar.classList.toggle("has-notes", n > 0);
    hint.textContent = n ? "" : words.hint;
    count.textContent = words.count(n);
    if (!flashTimer || copyBtn.textContent !== words.copied) copyBtn.textContent = words.copy;
    copyBtn.disabled = !n;
    doneBtn.textContent = words.done;
    if (sendBtn && !sendBtn.dataset.state) {
      sendBtn.textContent = words.send;
      sendBtn.disabled = !n;
    }
    if (mailLink && options.mailto) {
      const { to, cc } = options.mailto;
      const head = `mailto:${to}?${cc ? `cc=${encodeURIComponent(cc)}&` : ""}subject=${encodeURIComponent(words.subject(title()))}&body=`;
      const full = head + encodeURIComponent(message());
      mailLink.dataset.long = full.length > MAILTO_MAX ? "1" : "";
      mailLink.href = mailLink.dataset.long ? head + encodeURIComponent(words.tooLong) : full;
      mailLink.textContent = words.mail;
      mailLink.classList.toggle("is-disabled", !n);
    }
    if (bubble) {
      bubble.hidden = active;
      bubble.classList.toggle("has-notes", n > 0);
      bubble.replaceChildren(el("span", "pbp-bubble-icon"), el("span", "pbp-bubble-label", n ? words.pending(n) : words.open));
    }
  }
  const copy = async () => {
    const text = message();
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.append(t);
      t.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      t.remove();
      return ok;
    }
  };
  const clearSent = () => {
    notes = notes.filter((n) => n.lang !== lang());
    save();
    layout();
  };
  copyBtn.addEventListener("click", async () => {
    if (await copy()) flash(copyBtn, w().copied);
  });
  mailLink?.addEventListener("click", (e) => {
    if (!message()) return e.preventDefault();
    if (mailLink.dataset.long) void copy();
  });
  sendBtn?.addEventListener("click", async () => {
    const text = message();
    if (!text || sendBtn.dataset.state === "busy" || !options.send) return;
    sendBtn.dataset.state = "busy";
    sendBtn.textContent = w().sending;
    try {
      await options.send(text);
      sendBtn.dataset.state = "done";
      sendBtn.textContent = w().sent;
      clearSent();
      window.setTimeout(() => {
        delete sendBtn.dataset.state;
        refresh();
      }, 2500);
    } catch (err) {
      sendBtn.dataset.state = "error";
      sendBtn.textContent = w().failed(err instanceof Error ? err.message : String(err));
      window.setTimeout(() => {
        delete sendBtn.dataset.state;
        refresh();
      }, 4000);
    }
  });
  doneBtn.addEventListener("click", () => stop());
  bubble?.addEventListener("click", () => start());

  function start() {
    active = true;
    layout();
  }
  function stop() {
    closeNote();
    active = false;
    highlights()?.delete("pbp-hover");
    refresh();
  }

  layout();

  return {
    start,
    stop,
    toggle: () => (active ? stop() : start()),
    get active() {
      return active;
    },
    count: () => mine().filter((n) => n.text.trim()).length,
    message,
    destroy() {
      stop();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("load", onLoad, true);
      removeEventListener("resize", relayout);
      removeEventListener("scroll", onScroll, true);
      ro.disconnect();
      mo.disconnect();
      for (const p of placed.values()) {
        p.pin.remove();
        p.boxes.forEach((b) => b.remove());
      }
      for (const name of ["pbp-note", "pbp-open", "pbp-hover"]) highlights()?.delete(name);
      layer.remove();
      bar.remove();
      bubble?.remove();
      pop.remove();
    },
  };
}
