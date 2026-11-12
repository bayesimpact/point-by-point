import {
  RESOURCE_MIME_TYPE,
  getUiCapability,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  ResourceTemplate,
  type ClientCapabilities,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import { UI_HTML, UI_URI, VERSION } from "./ui.generated";

export const TOOL_NAME = "annotate_response";
export const UI_URI_TEMPLATE = "ui://point-by-point/annotate-v{version}.html";
export const MAX_MARKDOWN_LENGTH = 100_000;

export const TOOL_DESCRIPTION =
  "Displays your response in an interface where the user can annotate any sentence and send all their " +
  "annotations back in a single message. Use this tool for EVERY response meant for the user, instead of " +
  "writing the text in the chat. Pass the complete response as markdown, sources and follow-up questions " +
  "included. Write nothing else in the chat, and do not use another widget or a question form instead. " +
  "The user's reply quotes each sentence they react to between backticks, followed by their answer or " +
  "question; address each point in order. When there are two points or more, open the answer to each " +
  "with a blockquote of the user's note alone, cut to about ten words. Use blockquotes for nothing else: " +
  "the interface shows them as the user's points.";

// The skill's rules, for users who added the connector without the skill: hosts give these
// instructions to the model, so the connector works on its own. test/rules.test.ts checks that the
// description above, these instructions and plugin/skills state the same rules.
export const SERVER_INSTRUCTIONS = [
  `Send every response meant for the user through ${TOOL_NAME}, short or long, instead of writing it in the ` +
    "chat. Not for intermediate work the user does not need to read (tool calls, file edits in progress).",
  "",
  "How:",
  "- Write the complete response in markdown and pass it in `markdown`. Add a short `title` only when the " +
    "response has a natural one.",
  "- Write nothing else in the chat, before or after the call, not even a line announcing the interface, in " +
    "any language. When the tool returns, your turn is over.",
  "- Everything goes in the markdown: clarifications, caveats, follow-up questions and sources (as markdown " +
    "links).",
  "- Do not use another widget, diagram, card or question form instead. Ask clarifying questions as plain " +
    "sentences, so the user can answer them by annotating.",
  "- Keep sentences self-contained where you can: the user reacts sentence by sentence.",
  "",
  "Reading the replies: each line starts with a sentence or passage of your response quoted between " +
    "backticks, followed by the user's answer, objection or question about it. A first line such as " +
    '"(About an earlier response)" means the quotes come from one of your earlier responses. Backticks inside ' +
    "quotes were replaced by apostrophes.",
  "",
  `Address every point, in order, through ${TOOL_NAME} again. With two points or more, open the answer to ` +
    "each with a blockquote of the user's note alone (not the sentence it is about), cut to about ten words, " +
    "then answer in normal paragraphs. With a single point, do not quote it. Use blockquotes for nothing " +
    "else: the interface shows them as the user's points.",
  "",
  `If ${TOOL_NAME} answers that this client cannot show the interface, write your responses in the chat ` +
    `instead for the rest of the conversation, without calling ${TOOL_NAME} again.`,
].join("\n");

// Worded as an instruction with no status to repeat: a result such as "Response displayed" was echoed
// back to the user in their language, as a stray line under the interface.
export const TOOL_RESULT_TEXT =
  "The user sees your response now. Your turn is over: do not write anything after this call, not even " +
  "a sentence saying that the response is shown or open for annotation, in any language. Any text you " +
  "write would appear as a stray line under the interface.";

// The tool is declared to every client (see createServer), so a client that cannot render the
// interface may still call it: the user then sees nothing, and Claude must write the response itself.
export const NO_INTERFACE_RESULT_TEXT =
  "This client cannot show the annotation interface, so the user has not seen this response. Write the " +
  `same response in the chat now, as normal text, and keep writing in the chat for the rest of this ` +
  `conversation without calling ${TOOL_NAME} again.`;

/** True when the client announced the MCP Apps extension. The MIME types it lists are not checked. */
export function supportsUi(capabilities: ClientCapabilities | null | undefined): boolean {
  return getUiCapability(capabilities) !== undefined;
}

type JsonRpcMessage = { method?: unknown; params?: { capabilities?: unknown; _meta?: Record<string, unknown> } };

/** Whether the client renders the interface, and which evidence decided it. `reason` is a fixed string, safe to log. */
export type UiSupport = { ui: boolean; reason: string };

/**
 * True when the request carries ChatGPT's hints, such as `openai/locale`, which it adds to the `_meta`
 * of initialize and of tool calls. ChatGPT renders MCP Apps but may not announce the extension.
 */
function fromChatGpt(meta: Record<string, unknown> | undefined): boolean {
  return meta !== undefined && Object.keys(meta).some((key) => key.startsWith("openai/"));
}

/**
 * Reads the client's UI support from one HTTP request, without any server-side state:
 * - ChatGPT is recognised by the `openai/` hints in `_meta`, whatever it announces;
 * - 2026-07-28 requests carry the client capabilities in their `_meta` envelope;
 * - a 2025 `initialize` carries them in its params;
 * - later 2025 requests echo the session id handed out at `initialize`, which encodes the answer.
 * A 2025 request without that session id is assumed to render interfaces, like claude.ai.
 */
export function uiSupportFromRequest(body: unknown, sessionId: string | null): UiSupport {
  const message = (Array.isArray(body) ? body[0] : body) as JsonRpcMessage | undefined;
  if (fromChatGpt(message?.params?._meta)) return { ui: true, reason: "ChatGPT hints in _meta" };
  const envelope = message?.params?._meta?.[CLIENT_CAPABILITIES_META_KEY];
  if (envelope && typeof envelope === "object") {
    return supportsUi(envelope as ClientCapabilities)
      ? { ui: true, reason: "2026 envelope with the ui extension" }
      : { ui: false, reason: "2026 envelope without the ui extension" };
  }
  if (message?.method === "initialize") {
    return supportsUi(message.params?.capabilities as ClientCapabilities)
      ? { ui: true, reason: "2025 initialize with the ui extension" }
      : { ui: false, reason: "2025 initialize without the ui extension" };
  }
  if (sessionId?.startsWith(PLAIN_SESSION_PREFIX)) return { ui: false, reason: "2025 session opened without the ui extension" };
  if (sessionId?.startsWith(UI_SESSION_PREFIX)) return { ui: true, reason: "2025 session opened with the ui extension" };
  return { ui: true, reason: "2025 request without a session id of ours" };
}

export const UI_SESSION_PREFIX = "ui.";
export const PLAIN_SESSION_PREFIX = "plain.";

const inputSchema = {
  markdown: z
    .string()
    .max(MAX_MARKDOWN_LENGTH, `The response is too long: keep it under ${MAX_MARKDOWN_LENGTH} characters.`)
    .describe("The complete response, in markdown (headings, lists, tables and links allowed)."),
  title: z.string().max(200).optional().describe("Optional short title shown above the response."),
};

/**
 * One server instance per request. The tool and the instructions are the same for every client:
 * claude.ai keeps one tool list per connector, shared by all the user's apps, so a list served to a
 * client without interfaces (an empty one, in 0.10 to 0.20) stuck everywhere until the user
 * refreshed it. The difference is made when the tool is called: a client that cannot render the
 * interface gets a result asking Claude to write the response in the chat. `ui` is a function where
 * the answer is only known once the client has connected (the local server, over stdio).
 */
export function createServer(options: { ui: boolean | ((ctx: ServerContext) => boolean) }): McpServer {
  const server = new McpServer(
    { name: "point-by-point", title: "Point by point", version: VERSION },
    {
      capabilities: { tools: {}, resources: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  registerAppResource(
    server,
    "Annotation interface",
    UI_URI,
    {
      description: "Read-only view of a response where each sentence can be annotated.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { prefersBorder: false } },
    },
    async () => ({
      contents: [
        { uri: UI_URI, mimeType: RESOURCE_MIME_TYPE, text: UI_HTML, _meta: { ui: { prefersBorder: false } } },
      ],
    }),
  );

  // Widgets already in conversations point at the URI of the release they were made with. Each
  // release changes the URI so no host serves a stale cached interface, and earlier URIs keep
  // loading, with the current interface.
  server.registerResource(
    "Annotation interface, earlier releases",
    new ResourceTemplate(UI_URI_TEMPLATE, { list: undefined }),
    {
      description: "The annotation interface, for widgets created by earlier releases.",
      mimeType: RESOURCE_MIME_TYPE,
      _meta: { ui: { prefersBorder: false } },
    },
    async (uri) => ({
      contents: [
        { uri: uri.href, mimeType: RESOURCE_MIME_TYPE, text: UI_HTML, _meta: { ui: { prefersBorder: false } } },
      ],
    }),
  );

  registerAppTool(
    server,
    TOOL_NAME,
    {
      title: "Annotate response",
      description: TOOL_DESCRIPTION,
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ markdown }, ctx) => {
      if (markdown.trim() === "") {
        return {
          isError: true,
          content: [{ type: "text", text: "The response is empty: pass the complete response as markdown." }],
        };
      }
      const ui = typeof options.ui === "function" ? options.ui(ctx) : options.ui;
      if (!ui) return { content: [{ type: "text", text: NO_INTERFACE_RESULT_TEXT }] };
      return {
        content: [{ type: "text", text: TOOL_RESULT_TEXT }],
        structuredContent: { createdAt: Date.now() },
      };
    },
  );

  return server;
}
