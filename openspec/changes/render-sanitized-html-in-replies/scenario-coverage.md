# Scenario coverage — render-sanitized-html-in-replies

Every scenario the delta declares, and the assertion that would fail if its contract broke. A
scenario is `covered` only when a test's *assertions* — not its name — check the GIVEN/WHEN/THEN at
the boundary the scenario describes.

Two boundaries, and both are needed. jsdom parses and queries, so it can say what is in the tree —
but it executes no script and applies no cascade, so "the handler was removed" and "the handler was
kept and never fired" are the same picture there, and a `<style>` rule that escaped would leave
every jsdom assertion passing. Chromium answers those two, and the seeded transcript gives it a
message to answer them about. Where a scenario is about what reaches the document, it is cited in
both.

The new tests were mutation-checked rather than trusted green (tasks.md §3.6): dropping
`rehype-sanitize` fails eleven jsdom guards and all four browser tests — the injected
`<style>.prose-chat { display: none }</style>` lands and hides the whole transcript, which is
exactly the failure no unit suite can see; dropping `rehype-raw` fails fifteen; keeping the default
per-tag `className` narrowings fails the styling-hook guards.

Capability: `artifact-rendering` — one added requirement, `SanitizedRawHtmlInReplies` (8 scenarios).
Its two existing requirements are unchanged, and their behaviour is re-asserted under the filter by
the `ExistingRenderingIsUnchanged` row below.

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AStructuredSectionRendersAsElements | covered | `ui/src/components/AssistantMessage.test.tsx` — "renders a disclosure section as elements, not as visible markup" asserts `container.querySelector("details.source-list")` is non-null, that its `<summary>` carries the text, and that `container.textContent` does **not** contain `<details` (so escaping cannot pass this); `e2e/assistant-html.spec.ts` — "an extension's sources section renders as a real disclosure element" asserts the same section in Chromium, where `<details>` is the browser's own element |
| TheSectionFoldsAndUnfolds | covered | `ui/src/components/AssistantMessage.test.tsx` — "expands and collapses the section natively" asserts `details.open` is false, clicks the summary, asserts it is true; `e2e/assistant-html.spec.ts` — "an extension's sources section renders as a real disclosure element" asserts the body is *hidden*, opens it, reads its text back, closes it and asserts it is hidden again — visibility, which jsdom cannot judge; `ui/src/components/AssistantMessage.test.tsx` — "keeps a section the reader opened open as the reply keeps arriving" opens the section on a streaming item and asserts it is still open after a re-render that appended text, because `open` lives on the element and a remount would quietly close it |
| TheStylingHookSurvives | covered | `ui/src/components/AssistantMessage.test.tsx` — "keeps the class hook on the tags the default schema narrows" asserts `ul.refs`, `li.ref`, `a.ref-link` and `code.ref-id` all survive, which is the case the `*` entry alone does not carry; "keeps the class hook a host page styles the section through" asserts `pre.source-content` and its text; `e2e/assistant-html.spec.ts` asserts `ul.source-items li.source-item` has count 2 and the link's href in the browser |
| ExecutableMarkupNeverReachesTheDocument | covered | `ui/src/components/AssistantMessage.test.tsx` — "drops a script tag and its contents" (no `script` element, `__pwned` not even present as text, the following paragraph still rendered), "drops an inline event handler from an image", "drops an inline event handler from an allowed element", "drops a javascript: href, keeping the link text" (the `href` property is gone, not neutered); `e2e/assistant-html.spec.ts` — "nothing in the same reply executes" loads an `onerror` image whose `src` really 404s, waits for `image.complete`, clicks the defused link, and asserts `window.__outpostPwned` is `null` with zero `script` elements and zero `[onerror], [onclick], [onload]` — the only place a handler that survived would show itself |
| MarkupOutsideTheAllowListIsDropped | covered | `ui/src/components/AssistantMessage.test.tsx` — "drops an iframe", "drops a style element rather than letting it restyle the page", "drops a form and its inputs", "drops a style attribute", each also asserting the surrounding answer still renders; `e2e/assistant-html.spec.ts` — "nothing in the same reply executes" asserts zero iframes, forms and `input[name="token"]`, and "the reply cannot restyle the conversation around it" asserts no `<style>` whose text mentions `prose-chat` (counted by content, because mermaid legitimately emits one per diagram), that no `.prose-chat` block computes to `display: none`, and that the probe's computed `position` is `static` rather than the `fixed` its style attribute asked for |
| AReplyCannotShadowAGlobal | covered | `ui/src/components/AssistantMessage.test.tsx` — "namespaces an id so a reply cannot shadow a global on the host page" asserts `#token` is absent and `#user-content-token` present; `e2e/assistant-html.spec.ts` — "nothing in the same reply executes" asserts `#clobber-probe` count 0 and `#user-content-clobber-probe` count 1 inside the widget's shadow root, on a host page that is a separate origin |
| AnUnfinishedTagDoesNotBreakTheMessage | covered | `ui/src/components/AssistantMessage.test.tsx` — "draws an unfinished tag from a streaming reply without breaking the message" ends the text mid-`<summ`, and asserts both that the earlier text is still in the document and that the partial `details.source-list` opened cleanly |
| ExistingRenderingIsUnchanged | covered | `ui/src/components/AssistantMessage.test.tsx`, "the sanitize step leaves existing rendering alone" — "still renders a GFM table" (a `table` and an addressable cell), "still keeps the classes GFM task lists are styled by" (`li.task-list-item` and two checkboxes), "still tags a plain fence with its language" (`code.language-ts`), "still routes a mermaid fence to the diagram renderer", "still renders inline maths" (`.katex`), "still renders block maths in display mode" (`.katex-display`, the display/inline distinction the filter could silently flatten), "still loads a relative image through the raw-bytes endpoint", "still opens a relative link in the viewer", and "applies the same overrides to a link written as raw HTML" (the overrides reach an element the filter produced, not only one markdown produced). The whole pre-existing suite is the rest of this row: 49 tests in that file pass unchanged. `e2e/assistant-html.spec.ts` — "the diagrams and maths already in the transcript still render" asserts the seeded mermaid SVG and the structured-exchange control in the browser, and the full Playwright suite (`e2e/`) passes on the built app |

## Tooling fallbacks

- The OpenLore MCP server is not configured in this session and the `openlore` CLI is not installed
  in this checkout (`npx openlore` fails to resolve), so `orient()` was not available. Structure was
  established by targeted inspection instead — `rg` over `ui/src`, the `components` and
  `artifact-rendering` specs, and the installed dependencies' own source.
- The `openspec` CLI is likewise not installed here, so strict OpenSpec validation could not be run.
  `npm run check:scenarios` — the mechanical half that CI enforces — was run and passes.
- `npx playwright test` needs an `executablePath` for the browser this container ships
  (`/opt/pw-browsers/chromium-1194`), which the pinned `@playwright/test` does not look for. That
  was passed locally for the run and is not part of the diff; CI installs its own browser.
- `e2e/thinking-levels.spec.ts` ("a model that accepts every level still shows all six stops") fails
  in this container. It fails identically on a clean checkout of the base commit with the branch
  stashed, so it is pre-existing and unrelated to this change. Every other Playwright test passes:
  99 of 100 before this change's four were added, 103 of 104 after.
