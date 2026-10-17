import { describe, expect, it } from "vitest";
import { buildIndex, find, occurrenceOf } from "../src/textindex";

describe("text index", () => {
  it("collapses whitespace and separates blocks", () => {
    document.body.innerHTML = "<main><h2>Titre</h2><p>Une  phrase\n  ici. <b>Une</b> phrase ici.</p></main>";
    const index = buildIndex(document.querySelector("main")!);
    expect(index.text).toBe("Titre Une phrase ici. Une phrase ici.");
  });
  it("finds the same occurrence again", () => {
    document.body.innerHTML = "<main><p>Une phrase ici. <b>Une</b> phrase ici.</p></main>";
    const main = document.querySelector("main")!;
    const second = find(buildIndex(main), "Une phrase ici.", 1)!;
    expect(second.startContainer.parentElement?.tagName).toBe("B");
    expect(occurrenceOf(buildIndex(main), second)).toEqual({ quote: "Une phrase ici.", nth: 1 });
  });
  it("leaves its own interface out", () => {
    document.body.innerHTML = '<main><p>Texte <span data-pbp-ui>3</span>suite</p></main>';
    expect(buildIndex(document.querySelector("main")!).text).toBe("Texte suite");
  });
});
