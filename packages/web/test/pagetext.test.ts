import { describe, expect, it } from "vitest";
import { hitPage, lineBoxes, type PageText, type Word } from "../src/pagetext";

const line = (y: number, words: string[], x = 0.1): Word[] =>
  words.map((t, i) => [x + i * 0.08, y, x + i * 0.08 + 0.07, y + 0.015, t] as Word);

const page: PageText = {
  blocks: [
    line(0.06, ["IV.", "Les", "prochaines", "étapes"]),
    [...line(0.09, ["Les", "six", "groupes", "remettent", "leurs", "dossiers."]), ...line(0.11, ["Le", "Comité", "arrêtera", "la", "feuille."])],
  ],
};

describe("hitPage", () => {
  it("quotes the sentence under the point, not the whole block", () => {
    expect(hitPage(page, 0.43, 0.115)?.quote).toBe("Le Comité arrêtera la feuille.");
    expect(hitPage(page, 0.11, 0.095)?.quote).toBe("Les six groupes remettent leurs dossiers.");
  });
  it("keeps a numbered heading in one piece", () => {
    expect(hitPage(page, 0.11, 0.065)?.quote).toBe("IV. Les prochaines étapes");
  });
  it("returns null far from any word", () => {
    expect(hitPage(page, 0.9, 0.9)).toBeNull();
  });
  it("draws one box per line of the sentence", () => {
    const words = [...line(0.09, ["a", "b"]), ...line(0.11, ["c"])];
    expect(lineBoxes(words)).toHaveLength(2);
  });
});
