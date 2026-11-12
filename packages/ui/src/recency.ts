import { KEEP_MS, storedKeys } from "./drafts";

/**
 * Tells a widget whether a newer response exists in the conversation, so a message sent from it can
 * say it is about an earlier response.
 *
 * Every widget of the server shares an origin, whatever its conversation, so they compare creation
 * times over a BroadcastChannel, and only listen to the widgets of their own tab: another tab shows
 * another conversation. Once a widget learns it is not the latest, it remembers that in storage under
 * its own key, so the answer survives a reload even if the newer widget is not mounted yet.
 */
const CHANNEL = "point-by-point:recency";
const PREVIOUS_PREFIX = "point-by-point:previous:";
const TAB_KEY = "point-by-point:tab";

type Message = { type: "hello" | "here"; createdAt: number; tab: string };

/**
 * Names the tab: sessionStorage is shared by the widgets of one tab and by no other tab. Without it,
 * every widget answers to the same empty name, as before tabs were told apart.
 */
function tabId(): string {
  try {
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function watchRecency(key: string, createdAt: number, onPrevious: () => void): () => void {
  let previous = readFlag(key);
  const markPrevious = () => {
    if (previous) return;
    previous = true;
    writeFlag(key);
    onPrevious();
  };
  if (previous) onPrevious();

  if (typeof BroadcastChannel === "undefined") return () => {};
  const tab = tabId();
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || typeof message.createdAt !== "number" || message.tab !== tab) return;
    if (message.createdAt > createdAt) markPrevious();
    if (message.type === "hello" && message.createdAt !== createdAt) {
      channel.postMessage({ type: "here", createdAt, tab } satisfies Message);
    }
  };
  channel.postMessage({ type: "hello", createdAt, tab } satisfies Message);
  return () => channel.close();
}

/** Forgets the flags of responses created more than {@link KEEP_MS} ago: their key ends with that time. */
export function pruneRecencyFlags(now = Date.now()): void {
  try {
    for (const key of storedKeys(localStorage, PREVIOUS_PREFIX)) {
      const createdAt = Number(key.slice(key.lastIndexOf(":") + 1));
      if (Number.isFinite(createdAt) && now - createdAt > KEEP_MS) localStorage.removeItem(key);
    }
  } catch {
    // No storage: nothing was kept.
  }
}

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(PREVIOUS_PREFIX + key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    localStorage.setItem(PREVIOUS_PREFIX + key, "1");
  } catch {
    // No durable storage: the flag lives as long as the widget.
  }
}
