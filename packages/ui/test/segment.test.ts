import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/render";
import {
  indexPhrases,
  locateQuote,
  offsetsToRange,
  pointToOffset,
  quoteOfRange,
  segmentContainer,
  splitSentences,
} from "../src/segment";

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

  it("ends a sentence on an everyday word that is also an abbreviation", () => {
    expect(sentencesOf("The answer is no. But we can try.", "en")).toEqual(["The answer is no.", "But we can try."]);
    expect(sentencesOf("C'est de l'art. Mais pas seulement.")).toEqual(["C'est de l'art.", "Mais pas seulement."]);
    expect(sentencesOf("Il a commis un vol. La police arrive.")).toEqual(["Il a commis un vol.", "La police arrive."]);
  });

  it("keeps those abbreviations with the number they introduce", () => {
    expect(sentencesOf("See No. 5 Is the best. Then stop.", "en")).toEqual(["See No. 5 Is the best.", "Then stop."]);
    expect(sentencesOf("Voir art. 12 Du code. Fin.")).toEqual(["Voir art. 12 Du code.", "Fin."]);
    expect(sentencesOf("Read vol. II Of the series. Done.", "en")).toEqual(["Read vol. II Of the series.", "Done."]);
  });

  it("ends a sentence on a capital letter followed by an ordinary sentence", () => {
    expect(sentencesOf("Choose option A. Then continue.", "en")).toEqual(["Choose option A.", "Then continue."]);
    expect(sentencesOf("Prends la vitamine C. Elle aide.")).toEqual(["Prends la vitamine C.", "Elle aide."]);
    expect(sentencesOf("On garde le plan B. L'autre est trop cher.")).toEqual(["On garde le plan B.", "L'autre est trop cher."]);
    // An initial before a name stays with it.
    expect(sentencesOf("Ask J. Smith about it. Then rest.", "en")).toEqual(["Ask J. Smith about it.", "Then rest."]);
    expect(sentencesOf("Selon M. Le Pen, non. Fin.")).toEqual(["Selon M. Le Pen, non.", "Fin."]);
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

  it("quotes a range as one line, without the notes and the code it crosses", () => {
    const { root } = render("Une phrase.\n\n```\ncode\n```\n\nSecond paragraphe.");
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "note text";
    root.querySelector("p")!.after(note);
    const range = document.createRange();
    range.selectNodeContents(root);
    expect(quoteOfRange(range)).toBe("Une phrase. Second paragraphe.");
    range.selectNodeContents(root.querySelector("pre")!);
    expect(quoteOfRange(range)).toBe("");
  });

  it("finds a quote again from its text, nearest to where it was", () => {
    const { phrases } = render("On verra. Une phrase   avec\ndes espaces.\n\nOn verra. Fin de la réponse.");
    const text = phrases.map((entry) => entry.el.textContent).join("");
    const found = locateQuote(phrases, "phrase avec des espaces", 0)!;
    expect(text.slice(found.start, found.end).replace(/\s+/g, " ")).toBe("phrase avec des espaces");
    const first = locateQuote(phrases, "On verra.", 0)!;
    const second = locateQuote(phrases, "On verra.", text.length)!;
    expect(first.start).toBe(0);
    expect(second.start).toBe(text.lastIndexOf("On verra."));
    // Across two blocks, the quote has a space where the text has none.
    const across = locateQuote(phrases, "des espaces. On verra.", 0)!;
    expect(offsetsToRange(phrases, across.start, across.end)!.toString().replace(/\s+/g, " ")).toContain("des espaces.");
    expect(across.end).toBe(second.start + "On verra.".length);
    expect(locateQuote(phrases, "absent", 0)).toBeNull();
  });

  it("drops the attributes the interface keeps its own state in", () => {
    const { root } = render('<span data-s="0" data-id="1" aria-label="x" class="phrase" id="send" style="color:red">Texte.</span>');
    const span = root.querySelector("p > span")!;
    expect(span.getAttributeNames().filter((name) => name !== "class" || span.className !== "phrase")).toEqual([]);
    expect(root.querySelector("[data-id], [aria-label], [id], [style]")).toBeNull();
  });
});
