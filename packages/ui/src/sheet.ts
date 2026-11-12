import type { App } from "@modelcontextprotocol/ext-apps";

// In fullscreen, the Claude iOS app lays a translucent title bar (about 100px with the status bar)
// over the top of the frame, and its "Reply to Claude" field (about 140px with the home indicator)
// over the bottom, without reporting either as a safe area: keep the sheet's content between them.
// Measured in Claude only: other apps get the safe areas they report.
const CLAUDE_MOBILE_HEADER = 100;
const CLAUDE_MOBILE_FOOTER = 150;

export interface SheetOptions {
  app: App;
  /** The response, which holds the notes. */
  content: HTMLElement;
  collapseButton: HTMLButtonElement;
  previousNoteButton: HTMLButtonElement;
  nextNoteButton: HTMLButtonElement;
  isTouch(): boolean;
  /** True in Claude's apps, whose mobile bars cover the frame. */
  inClaude(): boolean;
}

/**
 * The two ways a note takes the screen on a phone: the fullscreen sheet, when the host grants
 * fullscreen, and the focus mode, which keeps only the note above the keyboard. Also the arrows that
 * go from note to note in the sheet.
 */
export interface Sheet {
  /** Follows the display mode the host announces. */
  setFullscreen(on: boolean): void;
  inSheet(): boolean;
  /** Asks the host for fullscreen and opens the note there; does nothing if the host refuses. */
  enterFullscreen(target: HTMLElement): Promise<void>;
  enterFocusMode(target: HTMLElement): void;
  leaveFocusMode(options?: { restoreFocus?: boolean }): void;
  leaveSheet(options?: { fromHost?: boolean }): void;
  /** The note that has the screen, if any. */
  focusTarget(): HTMLElement | null;
  updateNoteNav(): void;
}

export function createSheet(options: SheetOptions): Sheet {
  const { app, content, previousNoteButton, nextNoteButton } = options;
  let fullscreen = false;
  let focusTarget: HTMLElement | null = null;
  // The note last reached (by the arrows or by Done). Near the end of the response a note cannot be
  // scrolled to the middle, so while it is on screen, the arrows go from it rather than from the middle.
  let noteAnchor: HTMLElement | null = null;

  const inSheet = () => document.body.classList.contains("sheet");

  function setFullscreen(on: boolean) {
    fullscreen = on;
    document.body.classList.toggle("fullscreen", on);
    if (on) {
      const context = app.getHostContext();
      const covered = options.inClaude() && (context?.platform === "mobile" || options.isTouch());
      const top = Math.max(context?.safeAreaInsets?.top ?? 0, covered ? CLAUDE_MOBILE_HEADER : 0);
      const bottom = Math.max(context?.safeAreaInsets?.bottom ?? 0, covered ? CLAUDE_MOBILE_FOOTER : 0);
      document.documentElement.style.setProperty("--pbp-sheet-top", `${top + 12}px`);
      document.documentElement.style.setProperty("--pbp-sheet-bottom", `${bottom}px`);
    }
    if (!on && inSheet()) leaveSheet({ fromHost: true });
  }

  async function enterFullscreen(target: HTMLElement) {
    try {
      const result = await app.requestDisplayMode({ mode: "fullscreen" });
      if (result.mode !== "fullscreen") return;
      setFullscreen(true);
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
  function leaveFocusMode(leave: { restoreFocus?: boolean } = {}) {
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
    if (leave.restoreFocus !== false && !options.isTouch()) target.querySelector("textarea")?.focus();
  }

  function leaveSheet(leave: { fromHost?: boolean } = {}) {
    if (focusTarget) leaveFocusMode({ restoreFocus: false });
    if (!inSheet()) return;
    document.body.classList.remove("sheet");
    if (fullscreen && !leave.fromHost) {
      void app.requestDisplayMode({ mode: "inline" }).catch(() => undefined);
      setFullscreen(false);
    }
  }

  // ---------- Note navigation ----------

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
  options.collapseButton.addEventListener("click", () => leaveSheet());

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

  return {
    setFullscreen,
    inSheet,
    enterFullscreen,
    enterFocusMode,
    leaveFocusMode,
    leaveSheet,
    focusTarget: () => focusTarget,
    updateNoteNav,
  };
}
