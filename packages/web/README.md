# @point-by-point/web

Point by point on any web page. The MCP App annotates a response inside a conversation; this
package annotates a page someone is reading (a report, a note, a document shown page by page) and
hands the notes back as one message, in the same format and in the page's order:

```
`the quoted sentence` the note

`document.pdf, page 2 : the sentence on that page` another note
```

## What the reader does

- **A floating button, bottom right**, turns comment mode on. The button turns into a toolbar: the
  number of notes, Copy, Send (or Send by e-mail), Done.
- **A click drops a pin** on the sentence under the pointer, as in a design tool; a selection is
  widened to whole words. The passage is highlighted with the CSS Custom Highlight API, so nothing
  is inserted into the page: a table or a grid keeps its layout.
- **The note is written in a card beside its pin.** A pin left empty disappears when the card
  closes. Pins stay on the page after Done, numbered in page order, until the notes are sent.
- **Pages shown as images** (a PDF rendered one image per page, since phones show no PDF in a
  frame) are commented the same way when each page has its text beside it: a click quotes the
  sentence under the pointer and highlights its lines on the image. Without the text, the pin sits
  where the reader clicked and the quote names the page.
- **A pin lives in the nearest scrolling box** of what it marks, so pins on a document viewer that
  scrolls on its own move with the page they are on.
- Drafts are kept in the browser (localStorage), per page and per language, until they are sent.

## Using it

```js
import { mountPins } from "@point-by-point/web";
import "@point-by-point/web/pins.css";

mountPins({
  root: document.querySelector("main"),
  pages: {
    selector: ".viewer img",
    describe: (img) => ({ label: "note.pdf", page: Number(img.dataset.page), text: img.src.replace(/\.webp$/, ".json") }),
  },
  mailto: { to: "feedback@example.org", cc: "team@example.org" },
  // or: send: async (message) => { await fetch("/api/feedback", { method: "POST", body: message }); },
  // launcher: "none" to open it from your own button with the returned start()
});
```

Every colour and size of the interface is a `--pbp-*` variable (top of `src/styles.css`), so a site
restyles it from its own tokens.

## Page text

`bin/page-text.mjs` writes one JSON per page of a PDF, named like the page images (`1.json`,
`2.json`…), with each word's box in fractions of the page and the words grouped in paragraphs:

```sh
node bin/page-text.mjs document.pdf public/pages/
```

It needs poppler's `pdftotext`. Paragraphs are rebuilt from the lines rather than taken from
poppler's blocks, which are sometimes one per line and sometimes glue a heading to its paragraph.

## Development

```sh
pnpm --filter @point-by-point/web dev        # the demo, demo/index.html
pnpm --filter @point-by-point/web demo:pages # rebuilds the demo's PDF, page images and page text
pnpm --filter @point-by-point/web build      # dist/pins.js and dist/pins.css, unminified
```

The sentence splitting and the message format are the interface's own (`packages/ui/src/segment.ts`
and `compose.ts`), imported rather than copied.
