# point-by-point

Reply to Claude or ChatGPT **point by point**. The assistant shows its response in a read-only interface; you click any
sentence (or select any passage), write your reply or question under it, and send everything back
in a single message.

**Contents**

- [Install](#install)
  - [In Claude, as a plugin (recommended)](#in-claude-as-a-plugin-recommended)
  - [In Claude, without the plugin](#in-claude-without-the-plugin)
  - [In ChatGPT](#in-chatgpt)
  - [Try it](#try-it)
  - [If it doesn't work](#if-it-doesnt-work)
  - [Run your own copy of the server](#run-your-own-copy-of-the-server)
  - [For an organisation](#for-an-organisation)
  - [Anthropic's plugin directory](#anthropics-plugin-directory)
- [How it works](#how-it-works)
  - [What the interface does](#what-the-interface-does)
- [Privacy and security](#privacy-and-security)
- [Development](#development)
  - [Testing in claude.ai](#testing-in-claudeai)
  - [Mobile diagnostic](#mobile-diagnostic)
  - [Deploy](#deploy)
  - [Release](#release)
- [License](#license)

**1. Click a sentence or select a passage, and write under it.** Pointing at a sentence highlights
what a click will annotate.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/annotate-dark.png">
  <img src="docs/images/annotate-light.png" width="720" alt="A response from Claude in the point-by-point interface: one sentence and one passage are highlighted, each with a note written under it, and the Send button below.">
</picture>

**2. Draft your reply.** Your notes go to your message box as one message, in the
order of the response, and stay in place in the interface:

```
`First we migrate the database.` Back it up first.

`switch traffic` When exactly? Not during business hours.
```

**3. Claude answers each point**, under a quote of your note, in a new interface you can annotate
again.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/answer-dark.png">
  <img src="docs/images/answer-light.png" width="720" alt="Claude's next response: each of the user's notes is shown as a bubble, followed by Claude's answer to it.">
</picture>

The interface follows the app's light or dark theme (the images above follow yours).

It is an [MCP App](https://claude.com/blog/interactive-tools-in-claude): an MCP server that declares
one tool, `annotate_response`, whose interface is rendered inline in the conversation by hosts that
support MCP Apps (claude.ai, Claude Desktop, the Claude mobile apps, and ChatGPT on the web and in
its desktop app).

## Install

The server is hosted once for everyone (or [run your own copy](#run-your-own-copy-of-the-server));
there is nothing to install on your computer. Add it once to your account, in a browser: it then
applies everywhere you use that account (web, desktop and mobile apps). For Claude, do it on
[claude.ai](https://claude.ai); for ChatGPT, see [In ChatGPT](#in-chatgpt).

### In Claude, as a plugin (recommended)

The plugin brings the **connector** (the server) and the **skill** (which tells Claude to use it)
together, and keeps the skill up to date with each release.

1. Go to **Customize → Plugins → Add → Add marketplace** and enter:

   ```
   alexisjamet/point-by-point
   ```

2. Install the **point-by-point** plugin, which now appears among the plugins.
3. **Connect the connector.** Installing the plugin does not connect it: until you do, Claude
   has no `annotate_response` tool and answers in the chat as usual, without saying why. Open
   the plugin, go to its **Connectors** tab, where `point-by-point` shows **Not added**, and click
   **Connect**.

   <img src="docs/images/plugin-connect.png" width="720" alt="The point-by-point plugin page, Connectors tab: the point-by-point connector shows Not added, with a Connect button on its right.">

4. Check it in a new chat: `point-by-point` appears, turned on, in the chat's tools menu.
   **Try in chat** only uses point-by-point once the connector is connected.

To get each release without doing anything, turn on **Sync automatically** for the marketplace.

If you installed the connector or the skill by hand before, remove them from **Customize →
Connectors** and **Customize → Skills**, so they do not appear twice.

### In Claude, without the plugin

If your plan or organisation does not offer plugins, add the connector by hand: it tells Claude how
to use it on its own.

1. **Add the connector.** Go to **Settings → Connectors → Add custom connector**, give it a name
   (for example `point-by-point`) and paste this URL:

   ```
   https://point-by-point.brols.workers.dev/mcp
   ```

2. **Optional: add the skill.** It holds the same rules as the connector and makes Claude follow
   them more reliably. Download
   [`point-by-point-skill.zip`](https://github.com/alexisjamet/point-by-point/releases/latest/download/point-by-point-skill.zip),
   then upload it in **Settings → Capabilities → Skills**. Upload the `.zip` as it is: do not
   unzip it (if your browser unzipped it on its own, zip the `point-by-point` folder again). A skill
   uploaded this way does not update itself: upload the new archive to get a later release.

Menu names move from time to time; look for "Plugins", "Connectors" and "Skills" in the settings.

### In ChatGPT

ChatGPT shows MCP Apps on the web and in its desktop app. Add the server once as a custom MCP
server: it carries its own instructions, so no skill is needed.

1. In ChatGPT, open **Plugins** ([chatgpt.com/plugins](https://chatgpt.com/plugins)), select **+**,
   then **Add custom MCP server**.
2. Name it `point-by-point`. Under **Connection**, choose **Public endpoint** and paste:

   ```
   https://point-by-point.brols.workers.dev/mcp
   ```

3. Leave authentication off: the server needs no account. Review the warning, select **I understand
   and want to continue**, then **Create as a plugin**.
4. In a new chat, type `@` and pick **point-by-point**.

If **Add custom MCP server** is missing, turn on **Developer mode** in ChatGPT's settings (under
**Apps & Connectors → Advanced**, or **Security** on some accounts). Custom MCP servers depend on
your plan, and in a Business, Enterprise or Edu workspace an admin may have to allow them.

**Experimental: with the skill, in the ChatGPT desktop app.** This repository is also a plugin
marketplace in the portable format that ChatGPT's desktop app and Codex read. With the
[Codex CLI](https://developers.openai.com/codex) installed, run
`codex plugin marketplace add alexisjamet/point-by-point`, restart the ChatGPT desktop app, and
install **point-by-point** from the Plugins Directory, under that marketplace.

### Try it

Start a **new conversation** and ask anything. Instead of plain text, the answer appears in an
interface:

1. Click a sentence (or select a passage) and type your reply under it. Repeat for as many
   sentences as you like.
2. Press **Draft my reply** (in ChatGPT, **Send**). In Claude the message lands in your
   message box: press Enter to send it.
3. The assistant answers each of your points, in a new interface.

### If it doesn't work

- **Claude answers in plain text.** Check that the connector is connected (the plugin's
  **Connectors** tab must not say **Not added**, or **Customize → Connectors**) and turned on for
  this conversation (the tools menu in the message box), then start a new conversation. With the
  plugin or the skill, Claude says so in its first response when the connector is missing. Without
  the plugin, if it still happens, add the skill, or check that it is turned on in
  **Customize → Skills**.
- **ChatGPT answers in plain text.** Pick **point-by-point** with `@` in a new chat. After a new
  release, open the plugin in **Plugins** and select **Refresh**, so ChatGPT reads the current tool.
- **The connector says it has no tools.** Open the connector in the tools menu and refresh its tool
  list. Releases before 0.20.1 could leave claude.ai with an empty list until that refresh.
- **No "Plugins", "Skills" or "Add custom connector" in the settings.** These depend on your plan,
  and in a Team or Enterprise organisation an admin may have to allow them. Skills may also require
  code execution to be turned on in **Settings → Capabilities**. In ChatGPT, custom MCP servers
  need **Developer mode** (see [In ChatGPT](#in-chatgpt)).
- **The interface is blank or shows an error.** Reload the page; your notes are kept as a draft.

### Run your own copy of the server

The hosted server sees the text of Claude's responses (see [Privacy and security](#privacy-and-security)).
To keep it to yourself, deploy your own copy on a free [Cloudflare](https://dash.cloudflare.com/sign-up)
account. You need Node 22 or later and a terminal:

```sh
git clone https://github.com/alexisjamet/point-by-point.git
cd point-by-point
npm install -g pnpm
pnpm install
pnpm --filter @point-by-point/server exec wrangler login   # opens Cloudflare in your browser
pnpm run deploy
```

The last command prints your server's address, `https://point-by-point.<your-subdomain>.workers.dev`.
On a new Cloudflare account you may first have to choose that subdomain, under **Workers & Pages**
in the dashboard. Then follow [In Claude, without the plugin](#in-claude-without-the-plugin) (or [In ChatGPT](#in-chatgpt)) with your address plus `/mcp`
as the connector URL; the skill is the same. To get a new release later: `git pull && pnpm run deploy`.

### For an organisation

A Team or Enterprise admin adds the plugin from this repository to the organisation's plugin
catalogue; skill and connector reach everyone at once.

### Anthropic's plugin directory

Planned once the v1 is stable, through the
[plugin directory submission form](https://clau.de/plugin-directory-submission).

## How it works

1. Claude calls `annotate_response` with its response in markdown, instead of writing it in the chat.
2. The host loads the interface resource (`ui://point-by-point/annotate-v<major>.<minor>.html`) in a
   sandboxed iframe and passes it the markdown.
3. The interface renders the markdown (sanitised), splits it into sentences and lets you annotate.
4. The button hands the composed message to the host, which puts it in the message box (Claude) or
   sends it (ChatGPT) as if you had typed it.
5. Claude reads the quotes, answers each point, and responds through the tool again.

The tool is declared to every client. Clients that render MCP Apps get the interface: those that
announce the extension (`io.modelcontextprotocol/ui`), and ChatGPT, recognised by the `openai/`
hints it adds to its requests. Anywhere else — Claude Code in a terminal, the API without an MCP
Apps host — the tool answers that the interface cannot be shown, and the model writes its response
in the chat, so you never end up with an invisible response.

### What the interface does

- Click a sentence, or select a passage of more than two characters, to open a note under its
  paragraph. Click an annotated sentence again to return to its note.
- Every note hangs on a sentence or a passage; empty notes are ignored. The button only shows once a
  note has text, and then the hint goes away. In ChatGPT, from two notes on, it says how many it
  sends ("Send 2 annotations").
- Notes are sent in document order; backticks in quotes become apostrophes.
- The bubble icon in a note's corner starts a **new conversation** about that passage: it copies
  the passage and your note to your clipboard, and on claude.ai and in ChatGPT it also opens a new
  conversation in the app you are in, prefilled with them (through the host, as a link: desktop
  apps may open it in your browser). The note stays in place. A very long passage is shortened in
  the link, to keep it under 8,000 characters, never in the copy; your note never is. Claude
  Desktop asks to confirm a claude.ai link and then opens nothing, so there the button only copies:
  start a new conversation and paste.
- The button hands the message to the host. Claude places it in your message box (Claude Desktop
  under a caution banner it shows for every message an interactive app proposes), so the button
  reads **Draft my reply**; read it and press Enter to send it. ChatGPT sends it, so the
  button reads **Send**.
- The notes stay in place after a send, and are kept with the response's draft: the response keeps
  them as a record, and if you discard the message, the button hands it over again. A mark says
  where the message went, until you change a note. A widget from an earlier
  response can still send: its message starts with "(About an earlier response)".
- Every keystroke is saved as a draft and restored if the page reloads.
- Keyboard: Tab / Shift+Tab move between sentences, Enter opens a note, Escape leaves a note,
  Cmd/Ctrl+Enter sends.
- Mobile: creating a note does not open the keyboard; fields are 16 px (no iOS zoom). Opening a
  note asks the host for fullscreen; if the host refuses, a focus mode keeps only the quote, the
  field and a **Done** button above the keyboard. In fullscreen, **Done** shows the whole response
  at the note, still fullscreen, so you can go on to the next point; the send button or **Back to the
  conversation** returns inline.
- English and French, following the host's locale. Light and dark, following the host's theme.
- Links open through the host. Images are shown as links (the interface loads nothing remote).

## Privacy and security

The text of Claude's responses goes through the server, and so do your notes whenever Claude quotes
them back. Your notes themselves go from the interface to the conversation through the host, not
through the server.

The guarantees below hold for the code in this repository. The hosted server
(`point-by-point.brols.workers.dev`) is run by the author, and nothing lets you check that it runs
this code: using it means trusting the author, as you trust Anthropic with the conversation itself.
To trust no one but Cloudflare, [run your own copy](#run-your-own-copy-of-the-server).

What the code guarantees:

- **No storage, no content logs.** No KV, D1, R2 or Durable Objects. The Worker logs a few
  diagnostic lines: the name of an error, each tool list or call from a client that does not show
  interfaces, and each 2025-protocol request (method name, protocol version, status, whether the
  client shows interfaces). These lines are built from fixed strings only: never the markdown or
  anything else from the request. Cloudflare keeps them for a few days (Workers Logs), without the
  request URLs or headers.
- **No outbound calls**, from the server or the interface. Everything is inlined in one HTML file:
  no CDN script, font or image. The new conversation button only asks the host to open a link to
  claude.ai or chatgpt.com: the passage and the note in that link go to the app you are using,
  never to this server.
- **Sanitised rendering.** Markdown goes through `marked` then DOMPurify with a strict allow-list;
  if DOMPurify cannot run, the text is shown as plain text, never as raw HTML.
- **No authentication and no personal data.** A Cloudflare rate limit (1000 requests per minute per
  IP — generous, because claude.ai users share a few Anthropic egress IPs) caps abusive clients.
- **Minimal, pinned dependencies** (exact versions, lockfile), reviewed before each update.
- **MIT licence**, reproducible build from this repository.

Drafts are kept in the interface's own `localStorage` (inside the host's sandbox, on your device)
and deleted after a successful send.

## Development

TypeScript monorepo, pnpm workspaces, Node 22+.

```
packages/
  server/   Cloudflare Worker: MCP server (tool + interface resource)
  ui/       the annotation interface, built to a single HTML file
  web/      the same annotation on any web page: pins, page images, one message (packages/web/README.md)
plugin/     the plugin: skills/point-by-point, plus two manifests for the same plugin:
            .claude-plugin/plugin.json + .mcp.json (Claude),
            plugin.json + mcp.json (portable Agent Plugins format: ChatGPT, Codex)
.claude-plugin/marketplace.json   this repository as a plugin marketplace
```

```sh
pnpm install
pnpm build        # interface → packages/ui/dist/index.html, embedded into the Worker
pnpm test         # unit tests (segmentation, message format, drafts, server guards)
pnpm e2e          # Playwright: the built interface in a test host (desktop and mobile)
pnpm dev          # wrangler dev on http://localhost:8787/mcp
pnpm --filter @point-by-point/ui shots   # after a build: the README screenshots, light and dark
```

The server answers both MCP protocol eras without keeping state: 2026-07-28 requests carry the
client capabilities in every request; for 2025 clients the session id handed out at `initialize`
encodes whether the client renders interfaces.

### Testing in claude.ai

The real iframe and host context only exist in a real host. Expose the dev server with a
Cloudflare tunnel and add the tunnel URL as a custom connector:

```sh
pnpm dev
cloudflared tunnel --url http://localhost:8787
# add https://<random>.trycloudflare.com/mcp as a custom connector in claude.ai
```

### Mobile diagnostic

Ask Claude to call `annotate_response` with the markdown `/point-by-point-diagnostic`. Instead of a
response, the widget shows the display modes and device capabilities the host announces, can request
fullscreen, and can send its report back to the conversation.

### Deploy

```sh
pnpm run deploy   # builds, then wrangler deploy; prints the workers.dev URL
```

A fork deployed to another Cloudflare account gets its own URL: put it (with `/mcp`) in
`plugin/.mcp.json` and in your custom connector.

### Release

Bump `version` in `package.json`, `plugin/.claude-plugin/plugin.json`, `plugin/plugin.json` and
`.claude-plugin/marketplace.json`, then push a `v<version>` tag. The release workflow runs every
check, builds the interface under its versioned URI (a new URI per release, so no host serves a
stale cached interface), deploys the Worker and attaches the skill archive to the GitHub release.
The URIs of earlier releases keep being served, with the current interface, so widgets already in
conversations keep loading.
Deploying needs the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets;
without them the release is still published, the deploy step is skipped with a warning, and the
Worker is deployed by hand with `pnpm run deploy`.

## License

[MIT](LICENSE)
