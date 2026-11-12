import { beforeEach, describe, expect, it } from "vitest";
import { KEEP_COUNT, KEEP_MS, createDraftStore, hashText } from "../src/drafts";
import { pruneRecencyFlags } from "../src/recency";

describe("drafts", () => {
  beforeEach(() => window.localStorage.clear());

  it("saves, loads and clears a draft", () => {
    const store = createDraftStore(window.localStorage);
    expect(store.durable).toBe(true);
    const draft = { annotations: [{ kind: "sentence" as const, sentence: 2, start: 10, end: 20, quote: "q", text: "t" }] };
    store.save("k", draft);
    expect(store.load("k")).toEqual(draft);
    store.clear("k");
    expect(store.load("k")).toBeNull();
  });

  it("loads a draft from an earlier release without its general remark", () => {
    const annotations = [{ kind: "sentence", sentence: 0, start: 0, end: 5, quote: "q", text: "t" }];
    window.localStorage.setItem("point-by-point:draft:old", JSON.stringify({ annotations, remark: "r" }));
    expect(createDraftStore(window.localStorage).load("old")).toEqual({ annotations });
  });

  it("falls back to memory when storage throws", () => {
    const broken = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
      removeItem() { throw new Error("blocked"); },
    } as unknown as Storage;
    const store = createDraftStore(broken);
    expect(store.durable).toBe(false);
    const annotations = [{ kind: "selection" as const, start: 0, end: 4, quote: "kept", text: "in memory" }];
    store.save("k", { annotations });
    expect(store.load("k")?.annotations).toEqual(annotations);
  });

  it("drops the notes of responses left alone for too long, and keeps the others", () => {
    let time = 1_000_000;
    const store = createDraftStore(window.localStorage, () => time);
    const annotations = [{ kind: "selection" as const, start: 0, end: 4, quote: "q", text: "t" }];
    store.save("old", { annotations });
    time += KEEP_MS - 1000;
    store.save("recent", { annotations });
    // Saved by a release that kept no date: counted from the first prune that sees it.
    window.localStorage.setItem("point-by-point:draft:undated", JSON.stringify({ annotations }));
    window.localStorage.setItem("point-by-point:draft:broken", "{not json");
    window.localStorage.setItem("unrelated", "kept");
    time += 2000;
    store.prune();
    expect(store.load("old")).toBeNull();
    expect(store.load("recent")).toEqual({ annotations });
    expect(store.load("undated")).toEqual({ annotations });
    expect(window.localStorage.getItem("point-by-point:draft:broken")).toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("kept");
    time += KEEP_MS + 1;
    store.prune();
    expect(store.load("recent")).toBeNull();
    expect(store.load("undated")).toBeNull();
  });

  it("keeps the notes of a bounded number of responses, the latest ones", () => {
    let time = 0;
    const store = createDraftStore(window.localStorage, () => time);
    const annotations = [{ kind: "selection" as const, start: 0, end: 4, quote: "q", text: "t" }];
    for (let i = 0; i < KEEP_COUNT + 3; i++) {
      time = i;
      store.save(`k${i}`, { annotations });
    }
    store.prune();
    expect(store.load("k0")).toBeNull();
    expect(store.load("k2")).toBeNull();
    expect(store.load("k3")).not.toBeNull();
    expect(store.load(`k${KEEP_COUNT + 2}`)).not.toBeNull();
  });

  it("forgets the earlier-response flags of old responses", () => {
    const now = 10 * KEEP_MS;
    window.localStorage.setItem(`point-by-point:previous:abc:${now - KEEP_MS - 1}`, "1");
    window.localStorage.setItem(`point-by-point:previous:abc:${now - 1000}`, "1");
    pruneRecencyFlags(now);
    expect(Object.keys(window.localStorage)).toEqual([`point-by-point:previous:abc:${now - 1000}`]);
  });

  it("hashes text stably", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});
