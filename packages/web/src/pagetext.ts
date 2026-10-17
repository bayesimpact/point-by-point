import { normalizeSpaces } from "../../ui/src/compose";
import { splitSentences } from "../../ui/src/segment";

/**
 * The text of a page image, for a document shown as images (a PDF rendered page by page, since a
 * phone shows no PDF inside a frame). An image has no sentences, so a click on it would only say
 * "page 2, at the bottom", which nobody can act on. With the page's words and their boxes, a click
 * quotes the sentence under the pointer, as on the web page around it, and the pin sits on it.
 *
 * The file sits beside the image (`pages/2.webp` → `pages/2.json`); `bin/page-text.mjs` writes it
 * from the PDF with poppler's `pdftotext -bbox-layout`. Coordinates are fractions of the page, so
 * the file holds whatever size the image is shown at:
 *
 *   { "blocks": [ [ [x0, y0, x1, y1, "word"], … ], … ] }
 */

export type Word = [number, number, number, number, string];
export interface PageText {
  blocks: Word[][];
}
/** A box on the page, in fractions of its width and height. */
export type Box = [number, number, number, number];

export interface PageHit {
  /** The sentence under the point. */
  quote: string;
  /** Its lines, to draw on the image. */
  boxes: Box[];
}

/** A word this close to the point, in fractions of the page, still counts as under it. */
const REACH = 0.025;
/** A sentence shorter than this ("IV.", "1.") is joined to the next one. */
const SHORT = 12;

function distance(w: Word, x: number, y: number): number {
  const dx = x < w[0] ? w[0] - x : x > w[2] ? x - w[2] : 0;
  const dy = y < w[1] ? w[1] - y : y > w[3] ? y - w[3] : 0;
  return Math.hypot(dx, dy * 1.5);
}

/** The lines a run of words sits on, one box per line. */
export function lineBoxes(words: Word[]): Box[] {
  const boxes: Box[] = [];
  for (const w of words) {
    const line = boxes.at(-1);
    const middle = (w[1] + w[3]) / 2;
    if (line && middle > line[1] && middle < line[3] && w[0] >= line[0]) {
      line[2] = Math.max(line[2], w[2]);
      line[1] = Math.min(line[1], w[1]);
      line[3] = Math.max(line[3], w[3]);
    } else boxes.push([w[0], w[1], w[2], w[3]]);
  }
  return boxes;
}

/** The sentence at a point of the page, or null when the point is on no text. */
export function hitPage(page: PageText, x: number, y: number, locale = "fr"): PageHit | null {
  let best: { block: Word[]; word: number; d: number } | null = null;
  page.blocks.forEach((block) => {
    block.forEach((w, i) => {
      const d = distance(w, x, y);
      if (!best || d < best.d) best = { block, word: i, d };
    });
  });
  const hit = best as { block: Word[]; word: number; d: number } | null;
  if (!hit || hit.d > REACH) return null;

  // The block as one text, each word's place in it, then its sentences.
  const starts: number[] = [];
  let text = "";
  for (const w of hit.block) {
    if (text) text += " ";
    starts.push(text.length);
    text += w[4];
  }
  const ranges = splitSentences(text, locale).filter((r) => text.slice(r.start, r.end).trim());
  for (let i = 0; i < ranges.length - 1; i++) {
    if (text.slice(ranges[i]!.start, ranges[i]!.end).trim().length < SHORT) {
      ranges[i + 1] = { start: ranges[i]!.start, end: ranges[i + 1]!.end };
      ranges.splice(i, 1);
      i--;
    }
  }
  const at = starts[hit.word]!;
  const range = ranges.find((r) => at >= r.start && at < r.end) ?? { start: 0, end: text.length };
  const words = hit.block.filter((_, i) => starts[i]! >= range.start && starts[i]! < range.end);
  return { quote: normalizeSpaces(text.slice(range.start, range.end)), boxes: lineBoxes(words) };
}

const cache = new Map<string, Promise<PageText | null>>();

/** A page's text, fetched once; null when there is none (the image then gets a pin and its page). */
export function loadPage(url: string | undefined): Promise<PageText | null> {
  if (!url) return Promise.resolve(null);
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<PageText>) : null))
      .then((j) => (j && Array.isArray(j.blocks) ? j : null))
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}
