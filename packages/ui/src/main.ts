import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { compose, normalizeSpaces } from "./compose";
import { renderDiagnostic, isDiagnosticRequest } from "./diagnostic";
import { createDraftStore, hashText, type Draft, type DraftAnnotation } from "./drafts";
import { pickLang, t, type Lang, type Strings } from "./i18n";
import { chatAppFor, newChatModeFor, newChatPrompt, newChatUrl, type ChatApp, type NewChatMode } from "./newchat";
import { watchRecency } from "./recency";
import { renderMarkdown } from "./render";
import {
  indexPhrases,
  offsetsToRange,
  pointToOffset,
  segmentContainer,
  type PhraseEntry,
  type Sentence,
} from "./segment";
import "./styles.css";

declare const __APP_VERSION__: string;

interface Annotation extends DraftAnnotation {
  id: number;
  note: HTMLElement;
  textarea: HTMLTextAreaElement;
  range: Range | null;
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const content = $<HTMLElement>("#content");
const composer = $<HTMLElement>("#composer");
const sendButton = $<HTMLButtonElement>("#send");
const previousNoteButton = $<HTMLButtonElement>("#previous-note");
const nextNoteButton = $<HTMLButtonElement>("#next-note");
const statusLabel = $<HTMLElement>("#status");
const errorBox = $<HTMLElement>("#error");
const fallbackBox = $<HTMLElement>("#fallback");
const fallbackText = $<HTMLTextAreaElement>("#fallback-text");
const copyButton = $<HTMLButtonElement>("#copy");
const hintLabel = $<HTMLElement>("#hint");
const storageNotice = $<HTMLElement>("#storage-notice");

const coarsePointer = window.matchMedia("(pointer: coarse)");
const store = createDraftStore();

let lang: Lang = "en";
let s: Strings = t(lang);
let ready = false;
let sending = false;
let markdown = "";
let draftKey = "";
let previous = false;
let sentences: Sentence[] = [];
let phrases: PhraseEntry[] = [];
let nextId = 1;
const annotations = new Map<number, Annotation>();
const noteSlots = new WeakMap<HTMLElement, HTMLElement>();
let fullscreen = false;
let focusTarget: HTMLElement | null = null;

const app = new App({ name: "point-by-point", version: __APP_VERSION__ }, {}, { autoResize: true });

// ---------- Host context ----------

function applyHostContext(context: McpUiHostContext | undefined, initial = false) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  // Host font names are used through the variables, but host @font-face rules are not applied:
  // they would make the widget download fonts, and it makes no outbound calls.
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.safeAreaInsets) {
    const root = document.documentElement.style;
    root.setProperty("--pbp-safe-top", `${context.safeAreaInsets.top}px`);
    root.setProperty("--pbp-safe-bottom", `${context.safeAreaInsets.bottom}px`);
  }
  if (context.displayMode) setFullscreenClass(context.displayMode === "fullscreen");
  if (!context.locale && !initial) return;
  const nextLang = pickLang(context.locale ?? navigator.language);
  if (nextLang !== lang || initial) {
    lang = nextLang;
    s = t(lang);
    applyLabels();
  }
}

function isTouch(): boolean {
  const caps = app.getHostContext()?.deviceCapabilities;
  return coarsePointer.matches || (caps?.touch === true && caps.hover !== true);
}

function applyLabels() {
  document.documentElement.lang = lang;
  copyButton.textContent = s.copy;
  hintLabel.textContent = isTouch() ? s.hintTouch : s.hint;
  storageNotice.textContent = s.noStorage;
  if (!statusLabel.hidden) statusLabel.textContent = sentStatus();
  $<HTMLButtonElement>("#collapse").textContent = s.collapse;
  previousNoteButton.setAttribute("aria-label", s.previousNote);
  previousNoteButton.title = s.previousNote;
  nextNoteButton.setAttribute("aria-label", s.nextNote);
  nextNoteButton.title = s.nextNote;
  for (const sentence of sentences) labelSentence(sentence);
  for (const annotation of annotations.values()) labelNote(annotation);
  updateCount();
}

// ---------- Rendering ----------

function fullMarkdown(args: Record<string, unknown> | undefined): string | null {
  const body = typeof args?.markdown === "string" ? args.markdown : null;
  if (body === null) return null;
  const title = typeof args?.title === "string" ? args.title.trim() : "";
  return title ? `# ${title}\n\n${body}` : body;
}

let pendingPartial: string | null = null;
function renderPartial(text: string) {
  if (ready) return;
  const scheduled = pendingPartial !== null;
  pendingPartial = text;
  if (scheduled) return;
  requestAnimationFrame(() => {
    if (!ready && pendingPartial !== null) {
      content.replaceChildren(renderMarkdown(pendingPartial));
      labelCodeButtons();
      content.classList.remove("waiting");
      content.classList.add("streaming");
      content.setAttribute("aria-busy", "true");
    }
    pendingPartial = null;
  });
}

function renderFinal(text: string, diagnostic = false) {
  if (ready && text === markdown) return;
  markdown = text;
  pendingPartial = null;
  for (const annotation of annotations.values()) annotation.note.remove();
  annotations.clear();

  if (diagnostic) {
    content.classList.remove("streaming", "waiting");
    content.removeAttribute("aria-busy");
    renderDiagnostic(content, app, s, () => isTouch(), store.durable);
    composer.hidden = true;
    return;
  }

  content.replaceChildren(renderMarkdown(text));
  labelCodeButtons();
  content.classList.remove("streaming", "waiting");
  content.removeAttribute("aria-busy");
  sentences = segmentContainer(content, lang);
  phrases = indexPhrases(content);
  for (const sentence of sentences) {
    sentence.focusSpan.tabIndex = 0;
    sentence.focusSpan.setAttribute("role", "button");
    labelSentence(sentence);
  }
  // Keyed by the response text: hosts may send the tool call id only after the input, so a key
  // built from it could differ between the first load and a reload.
  draftKey = hashText(text);
  ready = true;
  composer.hidden = false;
  storageNotice.hidden = store.durable;
  restoreDraft();
  updateCount();
}

function labelSentence(sentence: Sentence) {
  const start = sentence.text.length > 60 ? `${sentence.text.slice(0, 60)}…` : sentence.text;
  const annotated = sentenceAnnotation(sentence.id) !== undefined;
  sentence.focusSpan.setAttribute("aria-label", annotated ? s.editAnnotation(start) : s.annotate(start));
}

// ---------- Annotations ----------

function sentenceAnnotation(sentenceId: number): Annotation | undefined {
  for (const annotation of annotations.values()) {
    if (annotation.kind === "sentence" && annotation.sentence === sentenceId) return annotation;
  }
  return undefined;
}

/** Where notes for a block go: right under it, or under the table for a cell. */
function slotFor(block: HTMLElement): HTMLElement {
  const host = block.closest<HTMLElement>(".table-wrap") ?? block;
  let slot = noteSlots.get(host);
  if (slot?.isConnected) return slot;
  slot = document.createElement("div");
  slot.className = "note-slot";
  if (host.matches("li")) {
    const nested = Array.from(host.children).find((child) => child.matches("ul, ol"));
    host.insertBefore(slot, nested ?? null);
  } else {
    host.after(slot);
  }
  noteSlots.set(host, slot);
  return slot;
}

function blockAt(offset: number): HTMLElement {
  const entry = phrases.find((candidate) => offset >= candidate.start && offset < candidate.end) ?? phrases.at(-1)!;
  const sentence = sentences[Number(entry.el.dataset.s)];
  return sentence?.block ?? entry.el;
}

function createAnnotation(draft: DraftAnnotation, options: { focus: boolean }): Annotation {
  const note = document.createElement("div");
  note.className = "note";
  note.setAttribute("role", "group");
  const quote = document.createElement("p");
  quote.className = "note-quote";
  quote.textContent = draft.quote;
  const textarea = document.createElement("textarea");
  textarea.rows = 2;
  textarea.value = draft.text;
  const actions = document.createElement("div");
  actions.className = "note-actions";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "note-done";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "note-remove";
  const newChat = document.createElement("button");
  newChat.type = "button";
  newChat.className = "note-newchat";
  actions.append(done);
  // New conversation and Remove sit in the top right corner (CSS), after the field in the tab order.
  note.append(quote, textarea, newChat, remove, actions);

  const annotation: Annotation = {
    ...draft,
    id: nextId++,
    note,
    textarea,
    range: draft.kind === "selection" ? offsetsToRange(phrases, draft.start, draft.end) : null,
  };
  note.dataset.id = String(annotation.id);
  labelNote(annotation);

  const slot = slotFor(blockAt(draft.start));
  const after = Array.from(slot.children).find(
    (child) => (annotations.get(Number((child as HTMLElement).dataset.id))?.start ?? Infinity) > draft.start,
  );
  slot.insertBefore(note, after ?? null);
  annotations.set(annotation.id, annotation);

  textarea.addEventListener("input", () => {
    annotation.text = textarea.value;
    autoGrow(textarea);
    hideError();
    updateCount();
    notesChanged();
  });
  textarea.addEventListener("focus", () => {
    if (isTouch()) enterFocusMode(note);
  });
  textarea.addEventListener("keydown", (event) => onFieldKeydown(event, annotation));
  done.addEventListener("click", () => leaveFocusMode());
  remove.addEventListener("click", () => removeAnnotation(annotation));
  newChat.addEventListener("click", () => void openNewChat(annotation));

  refreshHighlights();
  if (annotation.sentence !== undefined) {
    const sentence = sentences[annotation.sentence];
    if (sentence) labelSentence(sentence);
  }
  requestAnimationFrame(() => autoGrow(textarea));
  if (options.focus) openNote(annotation);
  return annotation;
}

function labelNote(annotation: Annotation) {
  const short = annotation.quote.length > 60 ? `${annotation.quote.slice(0, 60)}…` : annotation.quote;
  annotation.note.setAttribute("aria-label", s.noteLabel(short));
  annotation.textarea.placeholder = s.notePlaceholder;
  annotation.textarea.setAttribute("aria-label", s.notePlaceholder);
  annotation.note.querySelector(".note-done")!.textContent = s.done;
  const remove = annotation.note.querySelector<HTMLButtonElement>(".note-remove")!;
  remove.textContent = s.remove;
  remove.title = s.remove;
  const newChat = annotation.note.querySelector<HTMLButtonElement>(".note-newchat")!;
  const label = newChatMode() === "copy" ? s.newChatCopy : s.newChat;
  newChat.textContent = label;
  newChat.title = label;
}

function chatApp(): ChatApp {
  return chatAppFor(app.getHostVersion()?.name, "openai" in window);
}

function newChatMode(): NewChatMode {
  const context = app.getHostContext();
  return newChatModeFor({
    chatApp: chatApp(),
    canOpenLinks: !!app.getHostCapabilities()?.openLinks,
    platform: context?.platform,
    userAgents: [context?.userAgent, navigator.userAgent],
  });
}

/**
 * Starts a new conversation about the passage, in the app the interface is shown in. The text is
 * always copied; where a link can work, a new conversation also opens prefilled with it.
 */
async function openNewChat(annotation: Annotation) {
  hideError();
  const note = annotation.textarea.value;
  // The copy starts first, inside the click, where the browser allows it.
  const copied = copyText(newChatPrompt(annotation.quote, note, s.newChatIntro));
  if (newChatMode() === "copy") {
    showError((await copied) ? s.newChatCopiedOnly : s.newChatCopyFailed);
    return;
  }
  const url = newChatUrl(chatApp(), annotation.quote, note, s.newChatIntro);
  const opened = app.openLink({ url }).then(
    (result) => !result.isError,
    () => false,
  );
  const [didCopy, didOpen] = await Promise.all([copied, opened]);
  if (!didCopy) showError(s.newChatCopyFailed);
  else showError(didOpen ? s.newChatCopied : s.newChatNotOpened);
}

/** Brings a note into view: focus on desktop; on touch, no focus so the keyboard stays closed. */
function openNote(annotation: Annotation) {
  if (!isTouch()) {
    annotation.textarea.focus();
    return;
  }
  if (inSheet()) {
    enterFocusMode(annotation.note);
    window.scrollTo(0, 0);
    return;
  }
  annotation.note.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (app.getHostContext()?.availableDisplayModes?.includes("fullscreen")) {
    void enterFullscreen(annotation.note);
  }
}

function annotateSentence(sentence: Sentence) {
  const existing = sentenceAnnotation(sentence.id);
  if (existing) {
    openNote(existing);
    return;
  }
  const first = phrases.find((entry) => entry.el === sentence.spans[0]);
  const last = phrases.find((entry) => entry.el === sentence.spans.at(-1));
  createAnnotation(
    {
      kind: "sentence",
      sentence: sentence.id,
      start: first?.start ?? 0,
      end: last?.end ?? 0,
      quote: sentence.text,
      text: "",
    },
    { focus: true },
  );
  notesChanged();
}

function annotateSelection(range: Range) {
  const start = pointToOffset(phrases, range.startContainer, range.startOffset);
  const end = pointToOffset(phrases, range.endContainer, range.endOffset);
  const quote = quoteOf(range);
  if (end <= start || quote.length <= 2) return;
  for (const annotation of annotations.values()) {
    if (annotation.kind === "selection" && annotation.start === start && annotation.end === end) {
      openNote(annotation);
      return;
    }
  }
  window.getSelection()?.removeAllRanges();
  createAnnotation({ kind: "selection", start, end, quote, text: "" }, { focus: true });
  notesChanged();
}

/** The selected response text, without the text of any note it crosses. */
function quoteOf(range: Range): string {
  const fragment = range.cloneContents();
  for (const skipped of fragment.querySelectorAll(".note-slot, .note, .code-block")) skipped.remove();
  for (const block of fragment.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, td, th, pre, dt, dd")) {
    block.append(" ");
  }
  return normalizeSpaces(fragment.textContent ?? "");
}

function removeAnnotation(annotation: Annotation) {
  if (focusTarget === annotation.note) leaveFocusMode({ restoreFocus: false });
  annotations.delete(annotation.id);
  annotation.note.remove();
  refreshHighlights();
  const target = focusSpanFor(annotation);
  if (annotation.sentence !== undefined) {
    const sentence = sentences[annotation.sentence];
    if (sentence) labelSentence(sentence);
  }
  target?.focus({ preventScroll: true });
  updateCount();
  notesChanged();
}

/** The sentence that keyboard focus returns to when leaving or removing an annotation. */
function focusSpanFor(annotation: DraftAnnotation): HTMLElement | undefined {
  if (annotation.sentence !== undefined) return sentences[annotation.sentence]?.focusSpan;
  const entry = phrases.find((candidate) => annotation.start < candidate.end);
  return entry ? sentences[Number(entry.el.dataset.s)]?.focusSpan : undefined;
}

// ---------- Highlights ----------

const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

function refreshHighlights() {
  const annotated = new Set<number>();
  const ranges: Range[] = [];
  for (const annotation of annotations.values()) {
    if (annotation.sentence !== undefined) annotated.add(annotation.sentence);
    else if (annotation.range) ranges.push(annotation.range);
  }
  for (const sentence of sentences) {
    for (const span of sentence.spans) span.classList.toggle("annotated", annotated.has(sentence.id));
  }
  if (supportsHighlights) {
    CSS.highlights.set("pbp-selection", new Highlight(...ranges));
  } else {
    for (const entry of phrases) {
      entry.el.classList.toggle("annotated-passage", ranges.some((range) => range.intersectsNode(entry.el)));
    }
  }
}

// ---------- Mobile focus mode and fullscreen ----------

// In fullscreen, the Claude iOS app lays a translucent title bar (about 100px with the status bar)
// over the top of the frame, and its "Reply to Claude" field (about 140px with the home indicator)
// over the bottom, without reporting either as a safe area: keep the sheet's content between them.
const MOBILE_FULLSCREEN_HEADER = 100;
const MOBILE_FULLSCREEN_FOOTER = 150;

function setFullscreenClass(on: boolean) {
  fullscreen = on;
  document.body.classList.toggle("fullscreen", on);
  if (on) {
    const context = app.getHostContext();
    const mobile = context?.platform === "mobile" || isTouch();
    const top = Math.max(context?.safeAreaInsets?.top ?? 0, mobile ? MOBILE_FULLSCREEN_HEADER : 0);
    const bottom = Math.max(context?.safeAreaInsets?.bottom ?? 0, mobile ? MOBILE_FULLSCREEN_FOOTER : 0);
    document.documentElement.style.setProperty("--pbp-sheet-top", `${top + 12}px`);
    document.documentElement.style.setProperty("--pbp-sheet-bottom", `${bottom}px`);
  }
  if (!on && inSheet()) leaveSheet({ fromHost: true });
}

function inSheet(): boolean {
  return document.body.classList.contains("sheet");
}

async function enterFullscreen(target: HTMLElement) {
  try {
    const result = await app.requestDisplayMode({ mode: "fullscreen" });
    if (result.mode !== "fullscreen") return;
    setFullscreenClass(true);
    document.body.classList.add("sheet");
    enterFocusMode(target);
  } catch {
    // Refused or unsupported: the focus mode takes over when the field gets focus.
  }
}

function enterFocusMode(target: HTMLElement) {
  if (focusTarget && focusTarget !== target) focusTarget.classList.remove("active");
  focusTarget = target;
  target.classList.add("active");
  document.body.classList.add("focus-mode");
}

// Leaving a note keeps the sheet fullscreen: the frame scrolls itself there, so the note stays in
// view and the next point is a tap away. Back inline, the host owns the scroll and sends it to the
// bottom of the conversation.
function leaveFocusMode(options: { restoreFocus?: boolean } = {}) {
  const target = focusTarget;
  if (!target) return;
  focusTarget = null;
  target.classList.remove("active");
  document.body.classList.remove("focus-mode");
  (document.activeElement as HTMLElement | null)?.blur();
  const block = inSheet() ? "center" : "nearest";
  if (target.classList.contains("note")) noteAnchor = target;
  requestAnimationFrame(() => {
    target.scrollIntoView({ block });
    updateNoteNav();
  });
  if (options.restoreFocus !== false && !isTouch()) target.querySelector("textarea")?.focus();
}

function leaveSheet(options: { fromHost?: boolean } = {}) {
  if (focusTarget) leaveFocusMode({ restoreFocus: false });
  if (!inSheet()) return;
  document.body.classList.remove("sheet");
  if (fullscreen && !options.fromHost) {
    void app.requestDisplayMode({ mode: "inline" }).catch(() => undefined);
    setFullscreenClass(false);
  }
}

$<HTMLButtonElement>("#collapse").addEventListener("click", () => leaveSheet());

// ---------- Keyboard ----------

function onFieldKeydown(event: KeyboardEvent, annotation: Annotation | null) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void send();
    return;
  }
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (focusTarget) leaveFocusMode({ restoreFocus: false });
  (event.target as HTMLElement).blur();
  if (annotation) focusSpanFor(annotation)?.focus();
}

content.addEventListener("keydown", (event) => {
  if (!ready || (event.key !== "Enter" && event.key !== " ")) return;
  const phrase = (event.target as HTMLElement).closest<HTMLElement>(".phrase[data-s]");
  if (!phrase || phrase.closest(".note")) return;
  event.preventDefault();
  const sentence = sentences[Number(phrase.dataset.s)];
  if (sentence) annotateSentence(sentence);
});

// ---------- Pointer ----------

content.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest("a");
  if (link) {
    event.preventDefault();
    const href = link.href;
    if (/^(https?:|mailto:)/i.test(href)) void app.openLink({ url: href }).catch(() => undefined);
    return;
  }
  if (!ready || target.closest(".note")) return;
  // A mouse annotates what it selects, so a click only places the caret. A tap still annotates its
  // sentence, since selecting by touch is slow.
  const pointer = (event as PointerEvent).pointerType;
  if (pointer ? pointer === "mouse" : !isTouch()) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && content.contains(selection.anchorNode)) return;
  const phrase = target.closest<HTMLElement>(".phrase[data-s]");
  const sentence = phrase && sentences[Number(phrase.dataset.s)];
  if (sentence) annotateSentence(sentence);
});

/** True while the user types in a note: selections there belong to the field. */
function editingText(): boolean {
  const active = document.activeElement;
  return !!active && (active.tagName === "TEXTAREA" || active.tagName === "INPUT");
}

function selectionInContent(): Range | null {
  if (editingText()) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const inside = (node: Node) => {
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return !!element && content.contains(element) && !element.closest(".note");
  };
  if (!inside(range.startContainer) || !inside(range.endContainer)) return null;
  return selection.toString().trim().length > 2 ? range : null;
}

content.addEventListener("mouseup", (event) => {
  if (!ready || isTouch() || (event.target as HTMLElement).closest(".note")) return;
  setTimeout(() => {
    const range = selectionInContent();
    if (range) annotateSelection(range);
  }, 0);
});

// On touch, the selection handles keep moving after the finger lifts: wait until it settles.
let selectionTimer: ReturnType<typeof setTimeout> | undefined;
document.addEventListener("selectionchange", () => {
  if (!ready || !isTouch()) return;
  clearTimeout(selectionTimer);
  if (editingText()) return;
  selectionTimer = setTimeout(() => {
    const range = selectionInContent();
    if (range) annotateSelection(range);
  }, 900);
});

// ---------- Counter, drafts ----------

function autoGrow(field: HTMLTextAreaElement) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

function filledCount(): number {
  let count = 0;
  for (const annotation of annotations.values()) if (annotation.text.trim()) count++;
  return count;
}

function updateCount() {
  const count = filledCount();
  // Send (ChatGPT) says how many notes it sends; Draft my reply (Claude) does not. Either only shows
  // once a note has text; then the hint has done its job.
  if (!sending) {
    sendButton.textContent = hostInserts() ? s.insert : s.sendCount(count);
    sendButton.disabled = count === 0;
    sendButton.hidden = count === 0;
  }
  hintLabel.hidden = count > 0;
  updateNoteNav();
}

// ---------- Note navigation (fullscreen sheet) ----------

// The note last reached (by the arrows or by Done). Near the end of the response a note cannot be
// scrolled to the middle, so while it is on screen, the arrows go from it rather than from the middle.
let noteAnchor: HTMLElement | null = null;

function onScreen(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

/** The note before or after the current one, in document order. */
function adjacentNote(direction: "previous" | "next"): HTMLElement | undefined {
  const notes = Array.from(content.querySelectorAll<HTMLElement>(".note"));
  const anchor = noteAnchor ? notes.indexOf(noteAnchor) : -1;
  if (anchor >= 0 && onScreen(notes[anchor]!)) return notes[direction === "next" ? anchor + 1 : anchor - 1];
  const middle = window.innerHeight / 2;
  if (direction === "next") return notes.find((note) => note.getBoundingClientRect().top > middle + 1);
  return notes.findLast((note) => note.getBoundingClientRect().bottom < middle - 1);
}

function updateNoteNav() {
  previousNoteButton.disabled = !adjacentNote("previous");
  nextNoteButton.disabled = !adjacentNote("next");
}

function goToNote(direction: "previous" | "next") {
  const note = adjacentNote(direction);
  if (!note) return;
  noteAnchor = note;
  note.scrollIntoView({ block: "center" });
  note.classList.remove("arrived");
  void note.offsetWidth; // restart the glow when the same note is reached again
  note.classList.add("arrived");
  updateNoteNav();
}

content.addEventListener("animationend", (event) => {
  if (event.animationName === "pbp-arrive") (event.target as HTMLElement).classList.remove("arrived");
});

previousNoteButton.addEventListener("click", () => goToNote("previous"));
nextNoteButton.addEventListener("click", () => goToNote("next"));

let navFrame = 0;
window.addEventListener(
  "scroll",
  () => {
    if (!inSheet() || navFrame) return;
    navFrame = requestAnimationFrame(() => {
      navFrame = 0;
      updateNoteNav();
    });
  },
  { passive: true },
);

/** After a note is added, edited or removed: the status of the last send no longer holds. */
function notesChanged() {
  statusLabel.hidden = true;
  scheduleSave();
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 250);
}

function currentDraft(): Draft {
  return {
    annotations: Array.from(annotations.values()).map(({ kind, sentence, start, end, quote, text }) => ({
      kind,
      sentence,
      start,
      end,
      quote,
      text,
    })),
  };
}

function saveDraft() {
  clearTimeout(saveTimer);
  if (draftKey) store.save(draftKey, currentDraft());
}

function restoreDraft() {
  const draft = store.load(draftKey);
  if (!draft) return;
  for (const saved of draft.annotations) {
    if (saved.kind === "sentence" && (saved.sentence === undefined || !sentences[saved.sentence])) continue;
    createAnnotation(saved, { focus: false });
  }
}

window.addEventListener("pagehide", saveDraft);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveDraft();
});

// ---------- Sending ----------

function hideError() {
  errorBox.hidden = true;
  fallbackBox.hidden = true;
}

function showError(message: string) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

// Claude places an app's message in its message box, for the user to read and send; ChatGPT sends
// it. The button and the status say which.
function hostInserts(): boolean {
  return chatApp() === "claude";
}

function sentStatus(): string {
  return hostInserts() ? s.inserted : s.sent;
}

// The notes stay in place after a send: the response keeps them as a record, and if the message is
// discarded in the host, the button sends them again.
async function send() {
  if (!ready || sending) return;
  hideError();
  const message = compose(Array.from(annotations.values()).map(({ quote, text, start }) => ({ quote, text, order: start })), {
    contextLine: previous ? s.previousContext : undefined,
  });
  if (!message) {
    showError(s.nothingToSend);
    return;
  }

  sending = true;
  sendButton.disabled = true;
  sendButton.textContent = hostInserts() ? s.inserting : s.sending;
  try {
    const result = await app.sendMessage({ role: "user", content: [{ type: "text", text: message }] });
    if (result.isError) throw new Error("rejected");
    leaveSheet();
    if (focusTarget) leaveFocusMode({ restoreFocus: false });
    statusLabel.textContent = sentStatus();
    statusLabel.hidden = false;
  } catch {
    showError(s.sendFailed);
    fallbackText.value = message;
    fallbackBox.hidden = false;
  } finally {
    sending = false;
    updateCount();
  }
}

sendButton.addEventListener("click", () => void send());

/**
 * Copies through the clipboard API, or else from the fallback box, which then stays shown with the
 * text so it can be copied by hand.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallbackText.value = text;
    fallbackBox.hidden = false;
    fallbackText.focus();
    fallbackText.select();
    return document.execCommand?.("copy") ?? false;
  }
}

function labelCodeButtons() {
  for (const button of content.querySelectorAll(".code-copy")) button.setAttribute("aria-label", s.codeCopy);
}

/** Puts the code of a block on the clipboard without opening the message fallback box. */
async function copyCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = code;
    box.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.append(box);
    box.select();
    const copied = document.execCommand?.("copy") ?? false;
    box.remove();
    return copied;
  }
}

content.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".code-copy");
  const code = button?.parentElement?.querySelector("pre")?.textContent;
  if (!button || code == null) return;
  const copied = await copyCode(code.replace(/\n$/, ""));
  button.dataset.state = copied ? "copied" : "failed";
  button.setAttribute("aria-label", copied ? s.codeCopied : s.codeCopyFailed);
  setTimeout(() => {
    delete button.dataset.state;
    button.setAttribute("aria-label", s.codeCopy);
  }, 1800);
});

copyButton.addEventListener("click", async () => {
  showError((await copyText(fallbackText.value)) ? s.copied : s.copyFailed);
});

// ---------- Connection ----------

app.addEventListener("toolinputpartial", (params) => {
  const text = fullMarkdown(params.arguments);
  if (text !== null) renderPartial(text);
});

app.addEventListener("toolinput", (params) => {
  const text = fullMarkdown(params.arguments);
  if (text === null) return;
  // The command is read from the markdown alone: Claude may add a title to it.
  const body = params.arguments?.markdown;
  renderFinal(text, typeof body === "string" && isDiagnosticRequest(body));
  startRecencyWatch();
});

// The tool result carries the response's creation time, used to tell earlier responses apart.
let createdAt: number | null = null;
let watchingRecency = false;
function startRecencyWatch() {
  if (watchingRecency || createdAt === null || !draftKey) return;
  watchingRecency = true;
  watchRecency(`${draftKey}:${createdAt}`, createdAt, () => {
    previous = true;
  });
}

app.addEventListener("toolresult", (params) => {
  const value = (params.structuredContent as { createdAt?: unknown } | undefined)?.createdAt;
  if (typeof value !== "number") return;
  createdAt = value;
  startRecencyWatch();
});

app.addEventListener("hostcontextchanged", (params) => applyHostContext(params));

app.onteardown = async () => {
  saveDraft();
  return {};
};

lang = pickLang(navigator.language);
s = t(lang);
applyLabels();
content.textContent = s.loading;
await app.connect();
applyHostContext(app.getHostContext(), true);
if (!ready && content.classList.contains("waiting")) content.textContent = s.loading;
