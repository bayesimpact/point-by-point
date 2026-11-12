import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  type McpUiHostContext,
} from "@modelcontextprotocol/ext-apps";
import { writeClipboard } from "./clipboard";
import { compose } from "./compose";
import { renderDiagnostic, isDiagnosticRequest } from "./diagnostic";
import { createDraftStore, hashText, type Draft, type DraftAnnotation } from "./drafts";
import { pickLang, t, type Lang, type Strings } from "./i18n";
import { chatAppFor, newChatModeFor, newChatPrompt, newChatUrl, type ChatApp, type NewChatMode } from "./newchat";
import { pruneRecencyFlags, watchRecency } from "./recency";
import { renderMarkdown } from "./render";
import {
  indexPhrases,
  locateQuote,
  offsetsToRange,
  pointToOffset,
  quoteOfRange,
  segmentContainer,
  type PhraseEntry,
  type Sentence,
} from "./segment";
import { createSelectionMenu } from "./selection";
import { createSheet } from "./sheet";
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
store.prune();
pruneRecencyFlags();

let lang: Lang = "en";
let s: Strings = t(lang);
let ready = false;
let sending = false;
let markdown = "";
// A response's notes are kept under its text and its creation time, which the tool result brings:
// two responses with the same text keep their own notes. Until that time is known, and for results
// that carry none, the text alone is the key.
let textKey = "";
let draftKey = "";
let createdAt: number | null = null;
let previous = false;
let sentences: Sentence[] = [];
let phrases: PhraseEntry[] = [];
// The one sentence in the tab order; the arrow keys move it.
let currentSentence: Sentence | null = null;
let nextId = 1;
const annotations = new Map<number, Annotation>();
const noteSlots = new WeakMap<HTMLElement, HTMLElement>();

const app = new App({ name: "point-by-point", version: __APP_VERSION__ }, {}, { autoResize: true });

function isTouch(): boolean {
  const caps = app.getHostContext()?.deviceCapabilities;
  return coarsePointer.matches || (caps?.touch === true && caps.hover !== true);
}

function chatApp(): ChatApp {
  return chatAppFor(app.getHostVersion()?.name, "openai" in window);
}

const sheet = createSheet({
  app,
  content,
  collapseButton: $<HTMLButtonElement>("#collapse"),
  previousNoteButton,
  nextNoteButton,
  isTouch,
  inClaude: () => chatApp() === "claude",
});

const selectionMenu = createSelectionMenu({
  content,
  enabled: () => ready,
  isTouch,
  labels: () => s,
  canAnnotate: (range) => passageOf(range) !== null,
  onAnnotate: annotateSelection,
});

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
  if (context.displayMode) sheet.setFullscreen(context.displayMode === "fullscreen");
  if (!context.locale && !initial) return;
  const nextLang = pickLang(context.locale ?? navigator.language);
  if (nextLang !== lang || initial) {
    lang = nextLang;
    s = t(lang);
    applyLabels();
  }
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
  if (currentSentence) labelSentence(currentSentence);
  for (const annotation of annotations.values()) labelNote(annotation);
  selectionMenu.relabel();
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
  selectionMenu.hide();
  for (const annotation of annotations.values()) annotation.note.remove();
  annotations.clear();
  currentSentence = null;
  clearTimeout(bindTimer);
  draftKey = "";

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
  for (const sentence of sentences) sentence.focusSpan.tabIndex = -1;
  if (sentences[0]) setCurrentSentence(sentences[0]);
  textKey = hashText(text);
  ready = true;
  composer.hidden = false;
  storageNotice.hidden = store.durable;
  if (createdAt !== null) bindDraft(`${textKey}:${createdAt}`);
  // A host that sends no result, or a late one: the notes saved under the text alone show meanwhile.
  else bindTimer = setTimeout(() => bindDraft(textKey), 1500);
  updateCount();
}

// ---------- Sentences and the keyboard ----------

/**
 * One sentence is in the tab order, as a button named after its whole text; the arrow keys move
 * from sentence to sentence. Every sentence a tab stop and a button would make hundreds of stops,
 * and a screen reader would read the response as a list of buttons.
 */
function setCurrentSentence(sentence: Sentence) {
  if (currentSentence === sentence) return;
  if (currentSentence) {
    currentSentence.focusSpan.tabIndex = -1;
    currentSentence.focusSpan.removeAttribute("role");
    currentSentence.focusSpan.removeAttribute("aria-label");
  }
  currentSentence = sentence;
  sentence.focusSpan.tabIndex = 0;
  sentence.focusSpan.setAttribute("role", "button");
  labelSentence(sentence);
}

function labelSentence(sentence: Sentence) {
  if (sentence !== currentSentence) return;
  const annotated = sentenceAnnotation(sentence.id) !== undefined;
  sentence.focusSpan.setAttribute("aria-label", annotated ? s.editAnnotation(sentence.text) : s.annotate(sentence.text));
}

function sentenceOf(target: EventTarget | null): Sentence | undefined {
  const phrase = target instanceof Element ? target.closest<HTMLElement>(".phrase[data-s]") : null;
  if (!phrase || phrase.closest(".note")) return undefined;
  return sentences[Number(phrase.dataset.s)];
}

content.addEventListener("focusin", (event) => {
  const sentence = sentenceOf(event.target);
  if (sentence && sentence.focusSpan === event.target) setCurrentSentence(sentence);
});

const SENTENCE_KEYS: Record<string, (index: number) => number> = {
  ArrowDown: (index) => index + 1,
  ArrowRight: (index) => index + 1,
  ArrowUp: (index) => index - 1,
  ArrowLeft: (index) => index - 1,
  Home: () => 0,
  End: () => sentences.length - 1,
};

content.addEventListener("keydown", (event) => {
  if (!ready || event.altKey || event.ctrlKey || event.metaKey) return;
  const sentence = sentenceOf(event.target);
  if (!sentence || sentence.focusSpan !== event.target) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    annotateSentence(sentence);
    return;
  }
  const move = SENTENCE_KEYS[event.key];
  if (!move || event.shiftKey) return;
  event.preventDefault();
  sentences[move(sentences.indexOf(sentence))]?.focusSpan.focus();
});

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
    if (isTouch()) sheet.enterFocusMode(note);
  });
  textarea.addEventListener("keydown", (event) => onFieldKeydown(event, annotation));
  done.addEventListener("click", () => sheet.leaveFocusMode());
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
  if (sheet.inSheet()) {
    sheet.enterFocusMode(annotation.note);
    window.scrollTo(0, 0);
    return;
  }
  annotation.note.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (app.getHostContext()?.availableDisplayModes?.includes("fullscreen")) {
    void sheet.enterFullscreen(annotation.note);
  }
}

/** Where a sentence sits in the response text. */
function sentenceOffsets(sentence: Sentence): { start: number; end: number } {
  const first = phrases.find((entry) => entry.el === sentence.spans[0]);
  const last = phrases.find((entry) => entry.el === sentence.spans.at(-1));
  return { start: first?.start ?? 0, end: last?.end ?? 0 };
}

function annotateSentence(sentence: Sentence) {
  const existing = sentenceAnnotation(sentence.id);
  if (existing) {
    openNote(existing);
    return;
  }
  createAnnotation(
    { kind: "sentence", sentence: sentence.id, ...sentenceOffsets(sentence), quote: sentence.text, text: "" },
    { focus: true },
  );
  notesChanged();
}

/** What a selection would annotate, or null when it holds nothing to quote (code alone, a few characters). */
function passageOf(range: Range): { start: number; end: number; quote: string } | null {
  if (phrases.length === 0) return null;
  const start = pointToOffset(phrases, range.startContainer, range.startOffset);
  const end = pointToOffset(phrases, range.endContainer, range.endOffset);
  const quote = quoteOfRange(range);
  return end > start && quote.length > 2 ? { start, end, quote } : null;
}

function annotateSelection(range: Range) {
  const passage = passageOf(range);
  if (!passage) return;
  for (const annotation of annotations.values()) {
    if (annotation.kind === "selection" && annotation.start === passage.start && annotation.end === passage.end) {
      openNote(annotation);
      return;
    }
  }
  window.getSelection()?.removeAllRanges();
  createAnnotation({ kind: "selection", ...passage, text: "" }, { focus: true });
  notesChanged();
}

function removeAnnotation(annotation: Annotation) {
  if (sheet.focusTarget() === annotation.note) sheet.leaveFocusMode({ restoreFocus: false });
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

// ---------- Keyboard ----------

function onFieldKeydown(event: KeyboardEvent, annotation: Annotation | null) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void send();
    return;
  }
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (sheet.focusTarget()) sheet.leaveFocusMode({ restoreFocus: false });
  (event.target as HTMLElement).blur();
  if (annotation) focusSpanFor(annotation)?.focus();
}

// ---------- Pointer ----------

content.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const link = target.closest("a");
  if (link) {
    event.preventDefault();
    // The address as written: a relative one or an anchor would resolve to this frame's own address.
    const href = link.getAttribute("href") ?? "";
    if (/^(https?:|mailto:)/i.test(href)) void app.openLink({ url: link.href }).catch(() => undefined);
    return;
  }
  if (!ready || target.closest(".note")) return;
  // A mouse annotates what it selects, so a click only places the caret. A tap still annotates its
  // sentence, since selecting by touch is slow.
  const pointer = (event as PointerEvent).pointerType;
  if (pointer ? pointer === "mouse" : !isTouch()) return;
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && content.contains(selection.anchorNode)) return;
  const sentence = sentenceOf(target);
  if (sentence) annotateSentence(sentence);
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
  sheet.updateNoteNav();
}

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
  const key = draftKey || textKey;
  if (key) store.save(key, currentDraft());
}

/**
 * Sets where this response's notes are kept, and shows the notes saved there. Notes saved under the
 * text alone (before the creation time was known, or by a release that had no other key) move to it.
 */
let bindTimer: ReturnType<typeof setTimeout> | undefined;
function bindDraft(key: string) {
  clearTimeout(bindTimer);
  if (!ready || !textKey || key === draftKey) return;
  draftKey = key;
  let draft = store.load(key);
  if (!draft && key !== textKey) {
    draft = store.load(textKey);
    store.clear(textKey);
  }
  if (draft) restoreDraft(draft);
  if (annotations.size > 0) saveDraft();
  updateCount();
}

function restoreDraft(draft: Draft) {
  if (phrases.length === 0) return;
  for (const saved of draft.annotations) {
    const placed = placeSaved(saved);
    const shown = Array.from(annotations.values()).some(
      (annotation) =>
        annotation.kind === placed.kind &&
        annotation.start === placed.start &&
        annotation.end === placed.end &&
        annotation.quote === placed.quote,
    );
    if (!shown) createAnnotation(placed, { focus: false });
  }
}

/**
 * Checks that a saved note still sits on the text it quotes. Positions depend on how the response
 * was split into sentences, which a release or a change of language can alter: a note that no longer
 * matches is moved to where its quote reads, or, when the quote cannot be found, kept at its place
 * without a highlight. A note is never dropped.
 */
function placeSaved(saved: DraftAnnotation): DraftAnnotation {
  if (saved.kind === "sentence") {
    const same = saved.sentence !== undefined ? sentences[saved.sentence] : undefined;
    const sentence =
      same?.text === saved.quote
        ? same
        : sentences
            .filter((candidate) => candidate.text === saved.quote)
            .sort((a, b) => Math.abs(sentenceOffsets(a).start - saved.start) - Math.abs(sentenceOffsets(b).start - saved.start))[0];
    if (sentence) return { ...saved, sentence: sentence.id, ...sentenceOffsets(sentence) };
  } else {
    const range = offsetsToRange(phrases, saved.start, saved.end);
    if (range && quoteOfRange(range) === saved.quote) return saved;
  }
  const found = locateQuote(phrases, saved.quote, saved.start);
  if (found) return { kind: "selection", ...found, quote: saved.quote, text: saved.text };
  const end = phrases.at(-1)?.end ?? 0;
  const start = Math.min(Math.max(saved.start, 0), Math.max(end - 1, 0));
  return { kind: "selection", start, end: start, quote: saved.quote, text: saved.text };
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
    sheet.leaveSheet();
    if (sheet.focusTarget()) sheet.leaveFocusMode({ restoreFocus: false });
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

/** Copies a message; when the clipboard refuses, shows it in the fallback box to be copied by hand. */
async function copyText(text: string): Promise<boolean> {
  if (await writeClipboard(text)) return true;
  fallbackText.value = text;
  fallbackBox.hidden = false;
  fallbackText.focus();
  fallbackText.select();
  return false;
}

function labelCodeButtons() {
  for (const button of content.querySelectorAll(".code-copy")) button.setAttribute("aria-label", s.codeCopy);
}

content.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".code-copy");
  const code = button?.parentElement?.querySelector("pre")?.textContent;
  if (!button || code == null) return;
  const copied = await writeClipboard(code.replace(/\n$/, ""));
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

// The tool result carries the response's creation time: it keys the notes, and tells earlier
// responses apart.
let watchingRecency = false;
function startRecencyWatch() {
  if (watchingRecency || createdAt === null || !textKey) return;
  watchingRecency = true;
  watchRecency(`${textKey}:${createdAt}`, createdAt, () => {
    previous = true;
  });
}

app.addEventListener("toolresult", (params) => {
  const value = (params.structuredContent as { createdAt?: unknown } | undefined)?.createdAt;
  if (typeof value !== "number") {
    // A result without a creation time (an earlier release's): the text alone stays the key.
    if (createdAt === null) bindDraft(textKey);
    return;
  }
  createdAt = value;
  bindDraft(`${textKey}:${createdAt}`);
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
