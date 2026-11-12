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

// Intl.Segmenter ends a sentence after an abbreviation when the next word is capitalised
// ("M. Dupont", "Dr. Smith"). Three kinds of endings are joined to what follows.
const endsWith = (words: readonly string[]) => new RegExp(`(?:^|[\\s(«"'])(?:${words.join("|")})\\.$`, "u");

// Titles and abbreviations that are not words of their own: always joined.
const ABBREVIATION = endsWith([
  "M", "MM", "Mme", "Mmes", "Mlle", "Mlles", "Dr", "Pr", "Me", "Mgr", "St", "Ste",
  "Mr", "Mrs", "Ms", "Prof", "Sr", "Jr", "Inc", "Ltd", "Co", "Corp", "Gen", "Gov", "Sen", "Rep",
  "cf", "ex", "env", "éd", "ed", "réf", "ref", "vs", "approx", "av", "apr",
  "J.-C", "e\\.g", "i\\.e", "a\\.k\\.a", "U\\.S", "U\\.K",
]);

// Abbreviations that are also everyday words ("the answer is no.", "c'est de l'art.", "un vol."):
// joined only to a number ("no. 5", "vol. II", "art. 12").
const NUMBERED = endsWith(["[Nn]o", "[Nn]°", "pp?", "[Vv]ol", "[Aa]rt", "[Ff]ig", "[Cc]hap"]);
const STARTS_WITH_NUMBER = /^[\s(]*(?:\d|[IVXLCDM]{2,}\b)/;

// A capital letter alone is an initial ("J. R. R. Tolkien") or the end of a sentence ("option A.
// Then…"): joined to another initial, or to a capitalised word that does not usually open a sentence.
const INITIAL = endsWith(["\\p{Lu}"]);
const STARTS_WITH_INITIAL = /^\s*\p{Lu}\.(?:\s|$)/u;
const FIRST_WORD = /^[\s(«"']*(\p{L}+)/u;
const SENTENCE_OPENERS = new Set(
  (
    "the a an this that these those it its he she we you they i there here then but and or so if when while as in on " +
    "at for with to from by after before next now also however otherwise both each all no not yes what why how " +
    "which who where is are do does can let use see note my your our their his her " +
    "le la les l un une des du de ce cet cette ces il elle ils elles on nous vous je tu j c mais et ou donc car si " +
    "quand puis ensuite alors ainsi enfin dans sur pour avec sans par en à au aux après avant voici voilà oui non " +
    "pas que qui quoi comment pourquoi où est sont mon ma mes ton ta tes son sa ses notre votre leur leurs tout " +
    "tous toute chaque"
  ).split(" "),
);

/** True when a segment ends with an abbreviation or an initial, not with the end of its sentence. */
function joinsNext(segment: string, next: string | undefined): boolean {
  const end = segment.trimEnd();
  if (ABBREVIATION.test(end)) return true;
  if (next === undefined) return false;
  if (NUMBERED.test(end)) return STARTS_WITH_NUMBER.test(next);
  if (!INITIAL.test(end)) return false;
  if (STARTS_WITH_INITIAL.test(next)) return true;
  const word = FIRST_WORD.exec(next)?.[1];
  return word !== undefined && /^\p{Lu}/u.test(word) && !SENTENCE_OPENERS.has(word.toLowerCase());
}

/** Splits text into sentence ranges, keeping abbreviations and initials inside their sentence. */
export function splitSentences(text: string, locale = "fr"): TextRange[] {
  const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
  const segments = Array.from(segmenter.segment(text));
  const ranges: TextRange[] = [];
  let pendingStart: number | null = null;

  segments.forEach(({ segment, index }, position) => {
    const start: number = pendingStart ?? index;
    if (joinsNext(segment, segments[position + 1]?.segment)) {
      pendingStart = start;
      return;
    }
    pendingStart = null;
    ranges.push({ start, end: index + segment.length });
  });
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

/** Blocks whose end reads as a space in a quote that crosses them. */
const QUOTE_BLOCKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, pre, dt, dd";

/** The response text a range covers, as one line, without the notes and the code blocks it crosses. */
export function quoteOfRange(range: Range): string {
  const common = range.commonAncestorContainer;
  const within = common.nodeType === Node.ELEMENT_NODE ? (common as Element) : common.parentElement;
  if (within?.closest(".note, .code-block")) return "";
  const fragment = range.cloneContents();
  for (const skipped of fragment.querySelectorAll(".note-slot, .note, .code-block")) skipped.remove();
  for (const block of fragment.querySelectorAll(QUOTE_BLOCKS)) block.append(" ");
  return normalizeSpaces(fragment.textContent ?? "");
}

/**
 * Finds a quote in the response text, whatever its spaces and line breaks: the positions of the
 * occurrence nearest to `near`, or null. Used when a saved note no longer matches its position.
 */
export function locateQuote(entries: readonly PhraseEntry[], quote: string, near = 0): TextRange | null {
  const target = normalizeSpaces(quote);
  if (!target) return null;
  // The response text with every run of spaces as one space, and where each character comes from.
  let text = "";
  const origins: number[] = [];
  const space = (origin: number) => {
    if (text === "" || text.endsWith(" ")) return;
    text += " ";
    origins.push(origin);
  };
  let block: Element | null = null;
  for (const entry of entries) {
    const own = entry.el.closest(TEXT_BLOCKS);
    if (own !== block) space(entry.start);
    block = own;
    const raw = entry.el.textContent ?? "";
    for (let i = 0; i < raw.length; i++) {
      if (/\s/.test(raw[i]!)) space(entry.start + i);
      else {
        text += raw[i];
        origins.push(entry.start + i);
      }
    }
  }

  let best: TextRange | null = null;
  for (let at = text.indexOf(target); at >= 0; at = text.indexOf(target, at + 1)) {
    const found = { start: origins[at]!, end: origins[at + target.length - 1]! + 1 };
    if (!best || Math.abs(found.start - near) < Math.abs(best.start - near)) best = found;
  }
  return best;
}
