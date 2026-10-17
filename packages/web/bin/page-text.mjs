#!/usr/bin/env node
// The text of each page of a PDF, with its words' boxes, for the page images a site shows instead of
// the PDF (src/pagetext.ts reads it). One JSON per page, named like the images: 1.json, 2.json…
//
//   node bin/page-text.mjs document.pdf public/pages/
//
// Needs poppler's pdftotext. Coordinates are fractions of the page, rounded to 1/10 000.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [pdf, out] = process.argv.slice(2);
if (!pdf || !out) {
  console.error("usage: page-text.mjs <file.pdf> <output folder>");
  process.exit(1);
}
const xhtml = execFileSync("pdftotext", ["-bbox-layout", pdf, "-"], { encoding: "utf8", maxBuffer: 1 << 28 });
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (entities[e] ?? m),
  );
const num = (attrs, name) => Number(new RegExp(`${name}="([\\d.]+)"`).exec(attrs)?.[1] ?? 0);
const r = (v) => Math.round(v * 10000) / 10000;
const GAP = 0.7;
const FULL = 0.8;

mkdirSync(out, { recursive: true });
let n = 0;
for (const [, pageAttrs, page] of xhtml.matchAll(/<page([^>]*)>([\s\S]*?)<\/page>/g)) {
  n++;
  const w = num(pageAttrs, "width");
  const h = num(pageAttrs, "height");
  // Paragraphs, rebuilt from the lines: poppler's blocks are sometimes one per line, which would cut
  // a sentence that runs onto the next line, and sometimes glue a heading to its paragraph. A line
  // joins the paragraph above it when the gap between them is under GAP of a line's height and the
  // line above runs to the column's right edge (FULL of its width): a heading or a paragraph's last
  // line stops short, so what follows starts a new paragraph.
  const blocks = [];
  for (const [, flow] of page.matchAll(/<flow[^>]*>([\s\S]*?)<\/flow>/g)) {
    const lines = [];
    for (const [, la, line] of flow.matchAll(/<line([^>]*)>([\s\S]*?)<\/line>/g)) {
      const words = [];
      for (const [, a, text] of line.matchAll(/<word([^>]*)>([\s\S]*?)<\/word>/g)) {
        words.push([r(num(a, "xMin") / w), r(num(a, "yMin") / h), r(num(a, "xMax") / w), r(num(a, "yMax") / h), decode(text)]);
      }
      if (words.length) lines.push({ left: num(la, "xMin"), right: num(la, "xMax"), top: num(la, "yMin"), bottom: num(la, "yMax"), words });
    }
    const left = Math.min(...lines.map((l) => l.left));
    const right = Math.max(...lines.map((l) => l.right));
    let para = null;
    let prev = null;
    for (const line of lines) {
      const height = Math.min(line.bottom - line.top, prev ? prev.bottom - prev.top : Infinity);
      const gap = prev ? line.top - prev.bottom : -1;
      const full = prev && prev.right - left >= FULL * (right - left);
      if (para && full && gap >= 0 && gap < GAP * height) para.push(...line.words);
      else blocks.push((para = [...line.words]));
      prev = line;
    }
  }
  writeFileSync(join(out, `${n}.json`), JSON.stringify({ blocks }));
}
console.log(`${out}: ${n} page${n > 1 ? "s" : ""} of text`);
