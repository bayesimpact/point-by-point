/** What a widget needs to rebuild its unsent annotations after a reload. */
export interface DraftAnnotation {
  kind: "sentence" | "selection";
  /** Sentence index, for annotations made by clicking a sentence. */
  sentence?: number;
  /** Character offsets of the quoted passage in the response text. */
  start: number;
  end: number;
  quote: string;
  text: string;
}

export interface Draft {
  annotations: DraftAnnotation[];
}

const PREFIX = "point-by-point:draft:";

/** Notes are kept this long after their last change, and at most this many responses keep theirs. */
export const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
export const KEEP_COUNT = 200;

export interface DraftStore {
  readonly durable: boolean;
  load(key: string): Draft | null;
  save(key: string, draft: Draft): void;
  clear(key: string): void;
  /** Drops the notes of responses left alone for {@link KEEP_MS}, then the oldest beyond {@link KEEP_COUNT}. */
  prune(): void;
}

/** localStorage, wrapped so a blocked or missing store degrades to memory instead of throwing. */
export function createDraftStore(
  storage: Storage | undefined = safeLocalStorage(),
  now: () => number = Date.now,
): DraftStore {
  const memory = new Map<string, string>();
  const durable = storage !== undefined && probe(storage);
  const get = (key: string) => (durable ? tryRun(() => storage!.getItem(key)) : memory.get(key)) ?? null;
  const set = (key: string, value: string) => (durable ? tryRun(() => storage!.setItem(key, value)) : memory.set(key, value));
  const remove = (key: string) => (durable ? tryRun(() => storage!.removeItem(key)) : memory.delete(key));

  return {
    durable,
    load(key) {
      const raw = get(PREFIX + key);
      if (!raw) return null;
      try {
        const draft = JSON.parse(raw) as Draft;
        // Drafts from earlier releases also carry a general remark, which no longer exists: dropped.
        return Array.isArray(draft.annotations) ? { annotations: draft.annotations } : null;
      } catch {
        return null;
      }
    },
    save(key, draft) {
      if (draft.annotations.length === 0) remove(PREFIX + key);
      else set(PREFIX + key, JSON.stringify({ annotations: draft.annotations, savedAt: now() }));
    },
    clear(key) {
      remove(PREFIX + key);
    },
    prune() {
      if (!durable) return;
      const kept: { key: string; savedAt: number }[] = [];
      for (const key of storedKeys(storage!, PREFIX)) {
        const raw = get(key);
        let savedAt: unknown;
        try {
          savedAt = (JSON.parse(raw ?? "") as { savedAt?: unknown }).savedAt;
        } catch {
          remove(key);
          continue;
        }
        if (typeof savedAt !== "number") {
          // Saved by a release that kept no date: counted from now.
          savedAt = now();
          set(key, JSON.stringify({ ...(JSON.parse(raw!) as object), savedAt }));
        }
        if (now() - (savedAt as number) > KEEP_MS) remove(key);
        else kept.push({ key, savedAt: savedAt as number });
      }
      kept.sort((a, b) => b.savedAt - a.savedAt);
      for (const { key } of kept.slice(KEEP_COUNT)) remove(key);
    },
  };
}

/** The keys of a store that start with a prefix. Empty when the store cannot be read. */
export function storedKeys(storage: Storage, prefix: string): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // Unreadable: nothing to list.
  }
  return keys;
}

function safeLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function probe(storage: Storage): boolean {
  try {
    const key = `${PREFIX}probe`;
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function tryRun<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Short stable hash (FNV-1a) used to key drafts by the response text. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
