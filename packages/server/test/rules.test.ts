// The rules reach the model in three places: the tool's description, the server's instructions and
// the skill. They are worded for their place, so they are not generated from one text; this test
// keeps them from drifting apart: each rule must be stated wherever it applies.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compose } from "../../ui/src/compose";
import { t } from "../../ui/src/i18n";
import { NO_INTERFACE_RESULT_TEXT, SERVER_INSTRUCTIONS, TOOL_DESCRIPTION, TOOL_NAME } from "../src/server";

const oneLine = (text: string) => text.replace(/\s+/g, " ");
const skillFile = readFileSync(
  fileURLToPath(new URL("../../../plugin/skills/point-by-point/SKILL.md", import.meta.url).href),
  "utf8",
);
const SOURCES = {
  description: oneLine(TOOL_DESCRIPTION),
  instructions: oneLine(SERVER_INSTRUCTIONS),
  skill: oneLine(skillFile),
};
type Source = keyof typeof SOURCES;
const EVERYWHERE: Source[] = ["description", "instructions", "skill"];
const GUIDES: Source[] = ["instructions", "skill"];

const RULES: [rule: string, stated: RegExp, where: Source[]][] = [
  ["names the tool", new RegExp(TOOL_NAME), GUIDES],
  ["every response goes through the tool", /every response/i, EVERYWHERE],
  ["not for intermediate work", /intermediate work/, GUIDES],
  ["nothing else in the chat", /Write nothing else in the chat/, EVERYWHERE],
  ["sources and follow-up questions go in the markdown", /follow-up questions/, EVERYWHERE],
  ["no other widget or question form", /question form/, EVERYWHERE],
  ["sentences stand on their own", /self-contained/, GUIDES],
  ["replies quote between backticks", /between backticks/, EVERYWHERE],
  ["backticks in quotes become apostrophes", /apostrophes/, GUIDES],
  ["every point is addressed, in order", /every point, in order/i, GUIDES],
  ["a blockquote of the user's note opens each answer", /blockquote of (the user's|their) note alone/, EVERYWHERE],
  ["the blockquote is cut to about ten words", /about ten words/, EVERYWHERE],
  ["blockquotes are for nothing else", /blockquotes (for nothing else|only for this)/i, EVERYWHERE],
  ["a single point is not quoted", /single point, do not quote it/, GUIDES],
  ["a client without the interface gets the response in the chat", /cannot show the interface/, GUIDES],
];

describe("the rules, wherever they are written", () => {
  for (const [rule, stated, where] of RULES) {
    it(rule, () => {
      for (const source of where) expect(SOURCES[source], `${source} no longer says it`).toMatch(stated);
    });
  }

  it("the tool result for a client without the interface says what the guides announce", () => {
    expect(NO_INTERFACE_RESULT_TEXT).toMatch(/cannot show the annotation interface/);
  });

  it("the context line of an earlier response is the one the interface writes", () => {
    const line = t("en").previousContext;
    expect(SOURCES.instructions).toContain(`"${line}"`);
    expect(SOURCES.skill).toContain(`"${line}"`);
  });

  it("the skill's example of a reply is what the interface composes", () => {
    const message = compose([
      { quote: "quoted passage 2", text: "reply 2", order: 2 },
      { quote: "quoted sentence 1", text: "reply 1", order: 1 },
    ]);
    expect(skillFile).toContain(`\`\`\`\n${message}\n\`\`\``);
  });
});
