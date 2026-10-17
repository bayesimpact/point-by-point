import { normalizeSpaces } from "../../ui/src/compose";

/**
 * The text of a page as one string with its whitespace collapsed, and the way back to the DOM.
 *
 * A note on a web page keeps its quote, not a DOM path: the page may be rebuilt between two visits
 * (a new deploy, a language switch), and the quote is what the reader wrote about. Finding it again
 * means searching the page's text, which is what this index is for. Blocks are separated by a space,
 * so the end of a heading never runs into the next paragraph.
 */

/** Elements whose text is never part of the page: scripts, styles, and this tool's own interface. */
const SKIP = "script, style, noscript, template, textarea, [data-pbp-ui]";
/** A change of one of these between two text nodes counts as a space. */
const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote, figcaption, summary, pre, div, section, article, header, footer, figure, aside, nav, main, table, tr";

interface Segment {
  node: Text;
  /** map[i] is the position in the index of the node's character i; map[length] is its end. */
  map: number[];
}

export interface TextIndex {
  text: string;
  segments: Segment[];
}

const blockOf = (node: Node) => node.parentElement?.closest(BLOCK) ?? null;

export function buildIndex(root: Element): TextIndex {
  const segments: Segment[] = [];
  let text = "";
  let space = true;
  let block: Element | null = null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const b = blockOf(node);
    if (b !== block && !space) {
      text += " ";
      space = true;
    }
    block = b;
    const data = node.data;
    const map: number[] = new Array(data.length + 1);
    for (let i = 0; i < data.length; i++) {
      map[i] = text.length;
      if (/\s/.test(data[i]!)) {
        if (!space) {
          text += " ";
          space = true;
        }
      } else {
        text += data[i];
        space = false;
      }
    }
    map[data.length] = text.length;
    segments.push({ node, map });
  }
  return { text, segments };
}

/** The position in the index of a DOM point, or -1 when the point is outside the indexed text. */
export function offsetOf(index: TextIndex, node: Node, offset: number): number {
  const segment = index.segments.find((s) => s.node === node);
  if (segment) return segment.map[Math.min(offset, segment.map.length - 1)]!;
  // An element boundary: the first text node at or after it.
  const point = node.ownerDocument!.createRange();
  point.setStart(node, offset);
  for (const s of index.segments) if (point.comparePoint(s.node, 0) >= 0) return s.map[0]!;
  return -1;
}

function pointAt(index: TextIndex, at: number, end: boolean): [Text, number] | null {
  for (const s of index.segments) {
    const last = s.map[s.map.length - 1]!;
    if (at > last || (!end && at === last && s !== index.segments.at(-1))) continue;
    if (at < s.map[0]!) return [s.node, 0];
    for (let i = 0; i < s.map.length; i++) {
      if (s.map[i]! >= at) return [s.node, i];
    }
  }
  return null;
}

/** A DOM range from two positions in the index. */
export function rangeOf(index: TextIndex, start: number, end: number): Range | null {
  const a = pointAt(index, start, false);
  const b = pointAt(index, end, true);
  if (!a || !b) return null;
  const range = a[0].ownerDocument.createRange();
  range.setStart(...a);
  range.setEnd(...b);
  return range;
}

/** Every position where a quote occurs, in page order. */
export function occurrences(index: TextIndex, quote: string): number[] {
  const q = normalizeSpaces(quote);
  const out: number[] = [];
  if (!q) return out;
  for (let at = index.text.indexOf(q); at !== -1; at = index.text.indexOf(q, at + 1)) out.push(at);
  return out;
}

/** Which occurrence of its own text a range is: the key that finds it again on the next visit. */
export function occurrenceOf(index: TextIndex, range: Range): { quote: string; nth: number } {
  const start = offsetOf(index, range.startContainer, range.startOffset);
  const end = offsetOf(index, range.endContainer, range.endOffset);
  const quote = index.text.slice(start, end).trim();
  const nth = Math.max(0, occurrences(index, quote).findIndex((at) => at >= start));
  return { quote, nth };
}

/** The range of the nth occurrence of a quote, or of the first one when the page has changed. */
export function find(index: TextIndex, quote: string, nth = 0): Range | null {
  const q = normalizeSpaces(quote);
  const all = occurrences(index, q);
  const at = all[nth] ?? all[0];
  return at === undefined ? null : rangeOf(index, at, at + q.length);
}
