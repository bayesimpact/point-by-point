// The local server: the same tool and interface as the Worker, over stdio, started by Claude Code or
// Claude Desktop on the user's computer. The text of the responses then never leaves it for a server.
import { CLIENT_CAPABILITIES_META_KEY, type ClientCapabilities } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer, supportsUi } from "./server";
import { VERSION } from "./ui.generated";

if (process.argv.includes("--version")) {
  console.log(VERSION);
} else {
  serveStdio(
    () => {
      // 2026-07-28 requests carry the client's capabilities; a 2025 connection announced them once,
      // at initialize.
      const server = createServer({
        ui: (ctx) => {
          const envelope = ctx.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY as keyof typeof ctx.mcpReq.envelope];
          return supportsUi((envelope as ClientCapabilities | undefined) ?? server.server.getClientCapabilities());
        },
      });
      return server;
    },
    // The error name only, as the Worker does: a message can quote the request.
    { onerror: (error) => console.error(`mcp error: ${error.name}`) },
  );
}
