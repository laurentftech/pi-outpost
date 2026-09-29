## Why

`AssistantMessage` renders a reply with `ReactMarkdown` and no raw-HTML step, so markup in the
message text is escaped and shown as literal characters. Markdown has no disclosure element, no
class attribute and no way to say "this part of the answer is an appendix" — so a section that
should fold away arrives as a wall of `<details class="source-list">…` in the middle of the answer.

That blocks a real use of extensions: an extension loaded through `extensionPaths` appends a
structured section to the final answer — a sources block with excerpts, thumbnails and links back
to the documents the answer rests on — and a host page styles and enhances it through its classes.
The section is inert markup; it is escaped anyway, because the pipeline has no way to distinguish
markup an extension wrote from markup a model made up.

Nor should it: reply text is untrusted whoever produced it. The distinction to draw is not who
wrote the markup but what the markup does.

## What Changes

- Raw HTML in an assistant reply is parsed and rendered as elements rather than escaped, after
  being filtered against an allow-list. A `<details>` section folds and unfolds natively; a `class`
  survives so a host page's CSS and enhancements can find it.
- What the filter rejects never reaches the DOM: scripts, inline event handlers, `javascript:`
  URLs, `style` elements and attributes, framing elements, forms, and every element the allow-list
  does not name. `id` and `name` are namespaced, so a reply cannot shadow a global on the page a
  widget is embedded in.
- The filter runs over the whole message tree, the markdown-generated nodes included, because the
  text is untrusted end to end. Everything the transcript renders today — GFM, maths, mermaid,
  workspace images and file links — is inside the allow-list and is unchanged.
- The allow-list is the `hast-util-sanitize` default, the list the remark ecosystem uses for HTML
  in markdown. Nothing in it is loosened; `className` is added to it, on every element.
- Only assistant messages change. `CustomMessageCard`, `ToolMarkdown` and the file viewer keep
  escaping markup: tool output and file content are a different channel with a different reader.
- The embed widget mounts the same `App`, so it is covered by the same change.

## Capabilities

### Modified Capabilities

- `artifact-rendering`: it already governs what a reply renders from its text — workspace images
  and file links. Raw HTML is the third such rendering and belongs beside them, together with the
  guarantee that bounds it.

## Impact

- `ui/src/components/AssistantMessage.tsx` — the rehype pipeline gains `rehype-raw` and
  `rehype-sanitize` ahead of `rehype-katex`, and owns the schema they filter against.
- `ui/package.json` — `rehype-raw`, `rehype-sanitize`, `hast-util-sanitize`.
- No server, protocol, schema or configuration change. Nothing an extension or a model already
  emits renders differently unless it was markup being shown as text.
- `README.md` — the conversation's feature list.
