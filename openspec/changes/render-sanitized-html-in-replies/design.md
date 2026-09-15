# Design — rendering sanitized raw HTML in replies

## 1. Filter the whole tree, not only the raw part

`rehype-raw` reparses the document, so after it runs there is no seam between an element markdown
produced and one the message text wrote: both are plain hast. The filter therefore applies to
everything.

That is the right answer anyway. A reply is model or extension generated; the pipeline has no
authority that says one half of it is trustworthier than the other. Filtering everything costs
nothing here because every node markdown produces — tables, lists, code fences, task lists,
footnotes — is already inside the default allow-list, which is the list the remark ecosystem uses
for exactly this job.

## 2. Where `rehype-katex` sits

KaTeX output is library-generated and is full of `style` attributes and MathML elements the schema
would strip. It is also produced *from* text that has already been filtered. So the order is
`rehype-raw` → `rehype-sanitize` → `rehype-katex`: raw markup is filtered, and the trusted markup
the renderer then generates is not put through a filter written for untrusted input.

The alternative — sanitizing last — would mean either widening the schema to admit everything KaTeX
emits (`style`, `math`, `semantics`, `annotation`, `mrow`, …), which is most of what a filter is
there to refuse, or losing maths. Neither is a trade; the order is.

## 3. `className` is widened per tag, not only on `*`

`hast-util-sanitize` resolves a property against the tag's own entry first and consults the `*`
entry only when that one rejected the value (`properties()` in its `lib/index.js`). The two are not
merged. The default schema narrows `className` on seven tags — `a` to `data-footnote-backref`,
`code` to `language-*`, `h2` to `sr-only`, `li` to `task-list-item`, `ol` and `ul` to
`contains-task-list`, `section` to `footnotes` — so listing `className` under `*` alone leaves it
stripped on all seven.

A styling hook that works on `<details>` and on `<p>`, but silently not on the `<a>` or the `<li>`
inside them, is worse than no hook: it fails per element, invisibly, in the middle of a section
that otherwise works. So the narrowings are dropped and `*` carries the property.

Dropping them takes nothing away: each narrowing allowed exactly one value, and that value is still
allowed. `code`'s `language-*` still reaches the mermaid routing and the syntax highlighter;
`li`'s `task-list-item` still reaches the task-list styling.

What it does admit is any class name on any element, from untrusted text. A class is inert — it
carries no URL, no script, no behaviour — but it does reach whatever CSS the page has. A reply can
therefore borrow a class the application or the host page styles. That is the same power the reply
already has through markdown (a heading, a table, an image) and the cost of the hook the feature
exists to provide.

## 4. `details` and `summary`

Already in the default allow-list. They are named in the schema anyway, so the section the feature
exists for is guaranteed by this repository rather than by a detail of a dependency that a future
release could revisit.

## 5. Clobbering, and what it costs footnotes

The default schema prefixes `id`, `name`, `ariaDescribedBy` and `ariaLabelledBy` with
`user-content-` so that markup cannot shadow a global through named element access — the attack the
prefix exists to stop. The embed widget renders inside arbitrary host pages, which is exactly where
that matters, so the default stays.

It has one cost. `remark-rehype` already namespaces the ids it generates for GFM footnotes, and it
namespaces the `href`s that point at them; the filter prefixes the ids a second time and cannot
prefix an href, which is a URL rather than an identifier. So in a reply that uses footnotes, the
reference and back-reference links no longer jump to their notes. The notes themselves render, in
place, as they do today.

The alternative is `clobberPrefix: ""`, which restores footnote navigation exactly and hands
untrusted text an unprefixed `id`. Footnotes in a reply are an incidental capability of
`remark-gfm` — never specified here, never styled, never mentioned to the model in `WEB_UI_CONTEXT`
— and losing a jump within them is a smaller thing than handing a model-written `id` to a third
party's page. Should footnote navigation ever be wanted, the fix is a step that renames the
anchors, not a loosened filter.

## 6. What is deliberately not changed

- **The `img` and `a` component overrides.** They are applied by React after the filter and treat a
  root-relative `src` as a workspace path, so `<img src="/api/image?file=plot.png">` in an
  extension section resolves to `/files/raw?path=api/image`, as the same reference in markdown does
  today. That is the existing meaning of a workspace reference; changing it is a separate decision
  about URL resolution, not about sanitizing.
- **`WEB_UI_CONTEXT`.** The model is not told it can write HTML. The capability exists for
  extension-generated sections; inviting a model to write markup in prose answers is a product
  decision this change does not take, and it would need its own running-app evidence.
- **`CustomMessageCard`, `ToolMarkdown`, `FileViewer`.** Out of scope, per the issue.
