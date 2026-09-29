## 1. Establish what the allow-list actually does

- [x] 1.1 Read the installed `hast-util-sanitize@5.0.2` default schema rather than the issue's
  sketch of it, and record the three findings that changed the design: `details` and `summary` are
  already allowed; the schema is keyed by hast *property* names, so the attribute to add is
  `className` and not `class`; and seven tags narrow `className`, which the `*` entry does not
  override (design.md §3).
- [x] 1.2 Confirm `react-markdown@10` passes `allowDangerousHtml` to `remark-rehype`
  (`node_modules/react-markdown/lib/index.js`), so raw nodes survive to `rehype-raw`.
- [x] 1.3 Confirm how `rehype-katex@7` picks display mode (`lib/index.js`): `math-display`, or a
  `language-math` `<code>` inside a `<pre>`, which is the shape `$$…$$` produces. Block maths
  therefore survives the default `code` narrowing — the reason to widen `className` is the styling
  hook, not maths, and the code comment says so.
- [x] 1.4 Record the footnote/clobber interaction and the decision to keep the default prefix
  (design.md §5).

## 2. The pipeline

- [x] 2.1 Add `rehype-raw@7`, `rehype-sanitize@6` and `hast-util-sanitize@5` to `ui/package.json`.
- [x] 2.2 Build the chat schema in `ui/src/components/AssistantMessage.tsx` from `defaultSchema`:
  name `details`/`summary` explicitly, drop every per-tag `className` narrowing, and allow
  `className` on `*`. Export it so the allow-list itself can be asserted.
- [x] 2.3 Put the plugins in module-level order `rehypeRaw` → `rehypeSanitize` → `rehypeKatex`, with
  the remark list hoisted alongside, so the pipeline keeps one identity across streamed renders.

## 3. Proving it

- [x] 3.1 Verify the section renders: a `<details class="source-list">` is in the DOM as elements
  with none of its markup visible as text, it opens and closes on its summary, and its `<pre>`,
  `<ul>`, `<li>`, `<a>` and `<code>` keep their classes.
- [x] 3.2 Verify what must never arrive: script element, `onerror`, `onclick`, `javascript:` href,
  iframe, `<style>`, `style` attribute, form and its input, and the `user-content-` namespacing of
  an id — each asserted at the DOM, with the surrounding answer still rendering.
- [x] 3.3 Verify the transitions, not only the happy path: a reply that ends mid-tag still renders
  the text that arrived, and a section the reader opened stays open across the re-render every
  streamed token causes — `open` is on the element, so a remount would close it silently.
- [x] 3.4 Verify the regressions the filter could cause: GFM table, task list with its
  `task-list-item` class and checkboxes, `language-ts` fence, mermaid routing, inline maths, block
  maths as `.katex-display`, the workspace image rewritten to `/files/raw`, the workspace link
  opening the viewer, and the same link written as raw HTML.
- [x] 3.5 Guard the allow-list itself against a dependency bump: disclosure elements present and
  not duplicated, `className` on `*` with no tag narrowing it, and the defaults it is built on
  (`strip: script`, `clobber: id`, prefix, no `iframe`, no `style`, href protocols) unchanged.
- [x] 3.6 Mutation-check the new tests rather than trusting a green run: removing `rehype-sanitize`
  fails the eleven guards (and, vividly, makes an injected `<style>body{display:none}</style>` hide
  the rest of the suite's queries); removing `rehype-raw` fails the fifteen rendering guards;
  keeping the per-tag narrowings fails the styling-hook guards.
- [x] 3.7 Run the ui suite, `npm run lint`, `npm run typecheck`, and `npm run check:scenarios`.
- [x] 3.8 Exercise it in the running app with Playwright against the bench, not only in jsdom: a
  seeded reply carrying a sources section, opened and closed, and a reply carrying a script and an
  event handler, checked at the DOM.

## 4. Documentation

- [x] 4.1 `README.md` — the conversation's feature list says what a reply may now carry and what
  bounds it.
- [x] 4.2 Confirm nothing documented claims replies escape markup: `WEB_UI_CONTEXT`
  (`server/src/systemPrompt.ts`) describes markdown, maths, diagrams, links and images and is left
  unchanged on purpose (design.md §6); `docs/` has no claim about reply markup.
