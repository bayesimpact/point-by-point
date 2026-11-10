import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render";
import { indexPhrases, offsetsToRange, pointToOffset, segmentContainer, splitSentences } from "../src/segment";

function sentencesOf(text: string, locale = "fr") {
  return splitSentences(text, locale).map(({ start, end }) => text.slice(start, end).trim());
}

function render(markdown: string) {
  const root = document.createElement("div");
  root.append(renderMarkdown(markdown));
  document.body.replaceChildren(root);
  const sentences = segmentContainer(root, "fr");
  const phrases = indexPhrases(root);
  return { root, sentences, phrases };
}

describe("splitSentences", () => {
  it("splits French sentences", () => {
    expect(sentencesOf("Bonjour. Comment vas-tu ? Très bien !")).toEqual(["Bonjour.", "Comment vas-tu ?", "Très bien !"]);
  });

  it("keeps abbreviations and initials inside the sentence", () => {
    expect(sentencesOf("M. Dupont est arrivé. Il a vu Mme Martin.")).toEqual([
      "M. Dupont est arrivé.",
      "Il a vu Mme Martin.",
    ]);
    expect(sentencesOf("Voir cf. Annexe 2 pour le détail. Ensuite on verra.")).toEqual([
      "Voir cf. Annexe 2 pour le détail.",
      "Ensuite on verra.",
    ]);
    expect(sentencesOf("Written by J. R. R. Tolkien. A classic.", "en")).toEqual([
      "Written by J. R. R. Tolkien.",
      "A classic.",
    ]);
    expect(sentencesOf("Ask Dr. Smith. Then rest.", "en")).toEqual(["Ask Dr. Smith.", "Then rest."]);
  });

  it("does not split decimal numbers", () => {
    expect(sentencesOf("Le taux passe à 3.5 % cette année. Puis 4,2 %.")).toEqual([
      "Le taux passe à 3.5 % cette année.",
      "Puis 4,2 %.",
    ]);
  });
});

describe("segmentContainer", () => {
  it("wraps sentences without breaking links or inline formatting", () => {
    const { root, sentences } = render("Voici un [lien utile](https://example.com) dans une phrase. **Deuxième** phrase.");
    expect(sentences.map((s) => s.text)).toEqual([
      "Voici un lien utile dans une phrase.",
      "Deuxième phrase.",
    ]);
    const link = root.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.querySelector<HTMLElement>(".phrase")?.dataset.s).toBe("0");
    expect(root.querySelector<HTMLElement>("strong .phrase")?.dataset.s).toBe("1");
    expect(sentences[0]!.spans.length).toBe(3);
    expect(root.textContent?.trim()).toBe("Voici un lien utile dans une phrase. Deuxième phrase.");
  });

  it("splits list items, headings, cells and quotes separately", () => {
    const { sentences } = render(
      "# Titre\n\n- Premier point. Avec détail.\n- Second point\n  - Sous-point.\n\n| A | B |\n|---|---|\n| Cellule un. | Deux. |\n\n> Citation ici.",
    );
    expect(sentences.map((s) => [s.block.tagName, s.text])).toEqual([
      ["H1", "Titre"],
      ["LI", "Premier point."],
      ["LI", "Avec détail."],
      ["LI", "Second point"],
      ["LI", "Sous-point."],
      ["TH", "A"],
      ["TH", "B"],
      ["TD", "Cellule un."],
      ["TD", "Deux."],
      ["P", "Citation ici."],
    ]);
  });

  it("leaves code blocks out of the annotatable sentences, and gives them a copy button", () => {
    const { root, sentences } = render("Avant.\n\n```js\nconst a = 1. ;\nconst b = 2;\n```\n\n- item\n\n  ```\n  x. y\n  ```");
    expect(sentences.map((sentence) => sentence.text)).toEqual(["Avant.", "item"]);
    expect(root.querySelector("pre .phrase")).toBeNull();
    expect(root.querySelectorAll(".code-block > pre + button.code-copy")).toHaveLength(2);
  });

  it("maps selection boundaries to stable offsets, even with notes inserted", () => {
    const { root, phrases } = render("Une phrase. Une autre.\n\nSecond paragraphe.");
    const second = root.querySelectorAll("p")[1]!;
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "note text that must not count";
    root.querySelector("p")!.after(note);

    const textNode = second.querySelector(".phrase")!.firstChild!;
    const start = pointToOffset(phrases, textNode, 7);
    expect(start).toBe("Une phrase. Une autre.".length + 7);
    const range = offsetsToRange(phrases, start, start + 10)!;
    expect(range.toString()).toBe("paragraphe");
  });

  it("does not render images or raw HTML", () => {
    const { root } = render('Texte ![logo](https://example.com/x.png) <script>alert(1)</script><img src=x onerror=alert(1)>');
    expect(root.querySelector("img, script")).toBeNull();
    expect(root.querySelector("a")?.textContent).toBe("logo");
  });
});
