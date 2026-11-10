// The local server as Claude Code and Claude Desktop start it: the bundled file, over stdio.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { NO_INTERFACE_RESULT_TEXT, SERVER_INSTRUCTIONS, TOOL_NAME, TOOL_RESULT_TEXT } from "../src/server";
import { UI_URI, VERSION } from "../src/ui.generated";

const BUNDLE = fileURLToPath(new URL("../dist/point-by-point-server.mjs", import.meta.url).href);
const UI_CAPABILITIES = { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } };
type Era = "legacy" | "modern";

async function connect(options: { ui: boolean; era: Era }) {
  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    {
      capabilities: options.ui ? UI_CAPABILITIES : {},
      versionNegotiation: { mode: options.era === "modern" ? { pin: "2026-07-28" } : "legacy" },
    },
  );
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [BUNDLE] }));
  return client;
}

it("prints its version", () => {
  expect(execFileSync(process.execPath, [BUNDLE, "--version"], { encoding: "utf8" }).trim()).toBe(VERSION);
});

describe.each<Era>(["legacy", "modern"])("%s protocol over stdio", (era) => {
  it("serves the tool, its instructions and the interface", async () => {
    const client = await connect({ ui: true, era });
    const { tools } = await client.listTools();
    expect(tools.find((tool) => tool.name === TOOL_NAME)?._meta).toMatchObject({ ui: { resourceUri: UI_URI } });
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    const { contents } = await client.readResource({ uri: UI_URI });
    expect((contents[0] as { text: string }).text).toContain("<html");
    await client.close();
  });

  it("shows the response to a client that renders interfaces", async () => {
    const client = await connect({ ui: true, era });
    const result = await client.callTool({ name: TOOL_NAME, arguments: { markdown: "Hello. World." } });
    expect(result.content).toEqual([{ type: "text", text: TOOL_RESULT_TEXT }]);
    expect(result.structuredContent).toMatchObject({ createdAt: expect.any(Number) });
    await client.close();
  });

  it("asks Claude to answer in the chat when the client cannot show the interface", async () => {
    const client = await connect({ ui: false, era });
    const result = await client.callTool({ name: TOOL_NAME, arguments: { markdown: "Hello. World." } });
    expect(result.content).toEqual([{ type: "text", text: NO_INTERFACE_RESULT_TEXT }]);
    await client.close();
  });
});
