import DOMPurify from "dompurify";
import { Marked } from "marked";

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    // Images would make the widget fetch remote content: show them as links instead.
    image({ href, text }) {
      const label = text || href;
      return `<a href="${escapeAttr(href)}">${escapeText(label)}</a>`;
    },
    checkbox({ checked }) {
      return checked ? "☑ " : "☐ ";
    },
  },
});

const ALLOWED_TAGS = [
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code",
  "em", "strong", "del", "s", "a", "table", "thead", "tbody", "tr", "th", "td", "sup", "sub",
  "dl", "dt", "dd", "kbd", "span",
];
const ALLOWED_ATTR = ["href", "title", "align", "start", "colspan", "rowspan"];

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

/** Markdown → sanitised DOM fragment. Raw HTML from the model never reaches the page unsanitised. */
export function renderMarkdown(markdown: string, doc: Document = document): DocumentFragment {
  const purify = DOMPurify(doc.defaultView!);
  if (!purify.isSupported) {
    // Never fall back to unsanitised HTML: show the markdown as plain text instead.
    const fragment = doc.createDocumentFragment();
    for (const block of markdown.split(/\n{2,}/)) {
      const paragraph = doc.createElement("p");
      paragraph.textContent = block;
      fragment.append(paragraph);
    }
    return fragment;
  }
  const html = marked.parse(markdown, { async: false });
  const fragment = purify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    RETURN_DOM_FRAGMENT: true,
  }) as DocumentFragment;
  for (const table of fragment.querySelectorAll("table")) wrapTable(table, doc);
  for (const pre of fragment.querySelectorAll("pre")) wrapCode(pre, doc);
  return fragment;
}

/** A frame around the table, and inside it the part that scrolls sideways when the table is too wide. */
function wrapTable(table: HTMLTableElement, doc: Document) {
  const frame = doc.createElement("div");
  frame.className = "table-wrap";
  const scroller = doc.createElement("div");
  scroller.className = "table-scroll";
  table.replaceWith(frame);
  scroller.append(table);
  frame.append(scroller);
}

/** A frame around the code block, holding the button that copies its code. */
function wrapCode(pre: HTMLPreElement, doc: Document) {
  const frame = doc.createElement("div");
  frame.className = "code-block";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "code-copy";
  pre.replaceWith(frame);
  frame.append(pre, button);
}
