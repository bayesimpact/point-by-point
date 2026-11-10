---
name: point-by-point
description: Send every response meant for the user through the annotate_response tool, so they can annotate any sentence and reply point by point in one message. Use for all user-facing responses, including short ones, whenever the annotate_response tool is available; when it is missing, tells the user how to connect it. Also explains how to read the annotated replies that come back.
---

# Point by point

The `annotate_response` tool shows your response in an interface where the user can select any
passage (or tap a sentence on a phone), write a reply or a question under it, and send all their
notes back in a single message.

## When to use it

- For **every** response meant for the user, short or long, whenever `annotate_response` is available.
- Not for intermediate work the user does not need to read (tool calls, file edits in progress).

## How

1. Write the complete response in markdown: headings, paragraphs, lists, tables, code blocks and
   links all render. Images are shown as links.
2. Call `annotate_response` with that markdown in `markdown`. Add a short `title` only when the
   response has a natural one.
3. Write nothing else in the chat, before or after the call: the interface is the response.
   Not even a line announcing it, in any language ("The response is open for your annotations",
   "Ma réponse est affichée dans l'interface d'annotation"). When the tool returns, your turn is
   over: write no text at all after it.
4. Everything goes in the markdown: clarifications, caveats, follow-up questions and the sources
   list (as markdown links). Nothing is left for a separate message.
5. Do not present the response through another interface instead: no inline visual widget
   (diagram, card or form), no multiple-choice question form. Ask clarifying questions as plain
   sentences in the markdown, so the user can answer them by annotating.

Keep sentences self-contained where you can: the user reacts sentence by sentence, so each one
should make sense when quoted on its own.

## Reading the replies

The user's message comes back in this format, in the order of the response:

```
`quoted sentence 1` reply 1

`quoted passage 2` reply 2
```

- Each line that starts with a quote between backticks is about that exact sentence or passage.
  The text after the closing backtick is the user's answer, objection or question about it.
- A first line such as "(About an earlier response)" means the notes refer to one of your earlier
  responses, not the latest one: find the quoted sentences there.
- Backticks inside quotes were replaced by apostrophes, so a quote may differ from your text
  only on that point.

Address every point, in order. Answer through `annotate_response` again.

When the user made two points or more, open the answer to each one with a blockquote of their note
alone (not the sentence it is about), cut to about ten words, so they see which part of your
response answers what. Then answer below it, in normal paragraphs. With a single point, do not
quote it.

```markdown
> Back it up first.

Agreed: the migration now starts with a snapshot...

> When exactly?

After the health checks pass...
```

Use blockquotes only for this: the interface shows them as the user's points.

## When the tool is not available

If your tools can be searched or loaded on demand, look for `annotate_response` there first: it may
be listed only once found.

- **`annotate_response` is missing.** The point-by-point connector is not connected, or turned off
  for this conversation. Open your first response with one sentence saying so, in the user's
  language, and how to fix it. In Claude: **Customize → Plugins → point-by-point → Connectors →
  Connect** (without the plugin, **Settings → Connectors → Add custom connector**), and check that it
  is turned on in the chat's tools menu. In ChatGPT: open **Plugins**, check that point-by-point's
  MCP server is connected, and pick point-by-point with `@` in the chat. Either way, start a new
  conversation afterwards. Then answer normally in the chat. Say it once per conversation, not in
  every response.
- **`annotate_response` answers that this client cannot show the interface.** Answer normally in
  the chat for the rest of the conversation, without mentioning the tool.
