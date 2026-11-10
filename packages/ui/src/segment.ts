import { normalizeSpaces } from "./compose";

/** Blocks whose own text is split into sentences. */
const TEXT_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, dt, dd";

export interface Sentence {
  id: number;
  /** Every span holding a piece of the sentence; a sentence can cross links and inline formatting. */
  spans: HTMLElement[];
  /** The span that takes keyboard focus. */
  focusSpan: HTMLElement;
  /** The block the sentence belongs to (paragraph, list item, heading, cell). */
  block: HTMLElement;
  text: string;
}

export interface TextRange {
  start: number;
  end: number;
}

// Intl.Segmenter breaks after these when the next word is capitalised ("M. Dupont", "Dr. Smith").
const ABBREVIATION = new RegExp(
  "(?:^|[\\s(«\"'])(?:" +
    [
      "M", "MM", "Mme", "Mmes", "Mlle", "Mlles", "Dr", "Pr", "Me", "Mgr", "St", "Ste",
      "Mr", "Mrs", "Ms", "Prof", "Sr", "Jr", "Inc", "Ltd", "Co", "Corp", "Gen", "Gov", "Sen", "Rep",
      "cf", "p", "pp", "ex", "env", "vol", "no", "n°", "art", "chap", "fig", "éd", "ed", "réf", "ref",
      "vs", "approx", "av", "apr", "J.-C", "e\\.g", "i\\.e", "a\\.k\\.a", "U\\.S", "U\\.K",
      "[A-ZÀ-Ý]",
    ].join("|") +
    ")\\.$",
  "u",
);

/** Splits text into sentence ranges, keeping abbreviations and initials inside their sentence. */
export function splitSentences(text: string, locale = "fr"): TextRange[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const ranges: TextRange[] = [];
  let pendingStart: number | null = null;

  for (const { segment, index } of segmenter.segment(text)) {
    const start: number = pendingStart ?? index;
    const end = index + segment.length;
    if (ABBREVIATION.test(segment.trimEnd())) {
      pendingStart = start;
      continue;
    }
    pendingStart = null;
    ranges.push({ start, end });
  }
  if (pendingStart !== null) ranges.push({ start: pendingStart, end: text.length });
  return ranges;
}

function ownTextNodes(block: Element): Text[] {
  const nodes: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("pre")) continue;
    if (node.parentElement?.closest(TEXT_BLOCKS) === block) nodes.push(node as Text);
  }
  return nodes;
}

function makeSpan(doc: Document, text: string, id: number): HTMLElement {
  const span = doc.createElement("span");
  span.className = "phrase";
  span.dataset.s = String(id);
  span.textContent = text;
  return span;
}

/**
 * Wraps every sentence of the rendered response in `span.phrase` elements, without touching links
 * or inline formatting: each text node is cut at sentence boundaries and its pieces wrapped in place.
 * Code blocks are left out: they are copied, not annotated.
 */
export function segmentContainer(root: HTMLElement, locale = "fr"): Sentence[] {
  const doc = root.ownerDocument;
  const sentences: Sentence[] = [];
  const blocks = root.querySelectorAll<HTMLElement>(TEXT_BLOCKS);

  for (const block of blocks) {
    const nodes = ownTextNodes(block);
    const full = nodes.map((node) => node.data).join("");
    if (!full.trim()) continue;

    const ranges = splitSentences(full, locale)
      .filter((range) => full.slice(range.start, range.end).trim() !== "")
      .map((range) => {
        const sentence: Sentence = {
          id: sentences.length,
          spans: [],
          focusSpan: undefined as unknown as HTMLElement,
          block,
          text: normalizeSpaces(full.slice(range.start, range.end)),
        };
        sentences.push(sentence);
        return { ...range, sentence };
      });

    let offset = 0;
    for (const node of nodes) {
      const nodeStart = offset;
      const nodeEnd = offset + node.data.length;
      offset = nodeEnd;
      const pieces: Node[] = [];
      let cursor = nodeStart;
      for (const range of ranges) {
        const start = Math.max(range.start, nodeStart);
        const end = Math.min(range.end, nodeEnd);
        if (start >= end) continue;
        if (start > cursor) pieces.push(doc.createTextNode(full.slice(cursor, start)));
        const text = full.slice(start, end);
        const span = makeSpan(doc, text, range.sentence.id);
        range.sentence.spans.push(span);
        if (!range.sentence.focusSpan && text.trim()) range.sentence.focusSpan = span;
        pieces.push(span);
        cursor = end;
      }
      if (cursor < nodeEnd) pieces.push(doc.createTextNode(full.slice(cursor, nodeEnd)));
      node.replaceWith(...pieces);
    }
  }

  return sentences.filter((sentence) => sentence.focusSpan);
}

export interface PhraseEntry {
  el: HTMLElement;
  start: number;
  end: number;
}

/**
 * Gives every phrase element its position in the response text (`data-o`), counting only phrase
 * text. Positions stay valid when annotation notes are inserted between blocks.
 */
export function indexPhrases(root: HTMLElement): PhraseEntry[] {
  const entries: PhraseEntry[] = [];
  let offset = 0;
  for (const el of root.querySelectorAll<HTMLElement>(".phrase")) {
    const length = el.textContent?.length ?? 0;
    el.dataset.o = String(offset);
    entries.push({ el, start: offset, end: offset + length });
    offset += length;
  }
  return entries;
}

/** Length of the text between the start of `el` and a DOM point inside it. */
function lengthBefore(el: HTMLElement, node: Node, offset: number): number {
  const range = el.ownerDocument.createRange();
  range.setStart(el, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** Converts a DOM point (for example a selection boundary) to a position in the response text. */
export function pointToOffset(entries: readonly PhraseEntry[], node: Node, offset: number): number {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  const phrase = element?.closest<HTMLElement>(".phrase");
  const entry = phrase && entries.find((candidate) => candidate.el === phrase);
  if (entry) return entry.start + lengthBefore(entry.el, node, offset);

  // Between phrases: snap to the start of the next phrase.
  const point = node.ownerDocument!.createRange();
  point.setStart(node, offset);
  for (const candidate of entries) {
    if (point.comparePoint(candidate.el, 0) >= 0) return candidate.start;
  }
  return entries.at(-1)?.end ?? 0;
}

function locate(entry: PhraseEntry, offset: number): [Node, number] {
  const walker = entry.el.ownerDocument.createTreeWalker(entry.el, NodeFilter.SHOW_TEXT);
  let remaining = offset - entry.start;
  let last: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (remaining <= node.data.length) return [node, remaining];
    remaining -= node.data.length;
    last = node;
  }
  return last ? [last, last.data.length] : [entry.el, 0];
}

/** Rebuilds a DOM range from positions produced by {@link pointToOffset}. */
export function offsetsToRange(entries: readonly PhraseEntry[], start: number, end: number): Range | null {
  const first = entries.find((entry) => start >= entry.start && start < entry.end);
  const last = entries.findLast((entry) => end > entry.start && end <= entry.end);
  if (!first || !last) return null;
  const range = first.el.ownerDocument.createRange();
  range.setStart(...locate(first, start));
  range.setEnd(...locate(last, end));
  return range;
}
