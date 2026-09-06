## Context

See `proposal.md` — Why. What follows is the state of the code the design has to fit into, and the
constraints that pushed each decision.

The viewer already renders exactly what the export must reproduce, through a pipeline whose parts
are all present:

- `react-markdown` with `remarkGfm`, `remarkMath` and `rehypeKatex` (`FileViewer.tsx:596`). Its
  parser stack — `unified`, `remark-parse`, `mdast-util-from-markdown` — is already in
  `node_modules` transitively.
- `normalizeMathDelimiters` (`ui/src/util/markdownMath.ts`) rewrites `\(…\)` / `\[…\]` to `$` / `$$`
  before rendering, and repairs mixed pairs. By the time anything is parsed, **inline and display
  math are already distinguished by delimiter**.
- KaTeX 0.18.4, reached through `rehype-katex`. KaTeX has **no SVG output** — its modes are `html`,
  `mathml` and `htmlAndMathml`. It does emit MathML, which is what makes the OMML route possible.
- `Mermaid.tsx` lazy-loads mermaid behind a module-level cached promise (`loadMermaid`) and holds
  each rendered SVG in component state. `naturalWidth()` there already recovers a diagram's real
  width from its `viewBox`, because mermaid writes `width="100%"`.

The download precedent is `ui/src/presentations/tableExport.ts`: pure shaping, a writer pulled in
with `import()` so it lands in its own chunk, and a private `save()` that hands a `Blob` to the
browser. `server/src/zip.ts` reads archives only, and is server-side — not a candidate for writing
one.

## Goals / Non-Goals

**Goals:**
- One conversion path whose input is the same text the renderer is given, so the export cannot
  drift from what the reader is looking at.
- Equations that Word treats as equations and diagrams that Word draws as vectors, without making
  the document unopenable anywhere else.
- Every figure failure is local: one bad equation or undrawable diagram degrades to readable text
  and the export still succeeds.
- Nothing added to the main bundle for readers who never export.

**Non-Goals:**
- Byte-level or visual fidelity with the on-screen rendering. The export targets a Word page, not a
  screenshot of the viewer; fonts, measures and page geometry are Word's.
- Round-tripping. An exported document is a leaf — nothing reads it back.
- Any server involvement: no route, no tool, no workspace write. See `proposal.md` — Impact.

## Decisions

### D1 — Parse with the same remark stack the renderer uses, not a second parser

The export runs `normalizeMathDelimiters`, then parses with `unified` + `remark-parse` +
`remark-gfm` + `remark-math`, and walks the resulting mdast.

*Why:* the failure this design most needs to avoid is an export that disagrees with the rendering —
a table the viewer shows and the export flattens, a `$` the viewer treats as a price and the export
treats as math. Sharing the parser makes whole classes of that impossible rather than merely
unlikely. `remark-math` also hands us `inlineMath` and `math` as distinct node types, which is
precisely the distinction the equation requirement rests on.

*Alternatives:* a hand-rolled line parser (rejected — divergence is the defect class this whole
decision exists to prevent); walking the rendered DOM (rejected — couples the export to a mounted
component, and the split/source view modes would each produce a different export).

### D2 — Build the package with `docx`, not by hand

Add `docx` (v9.7.1) as a UI dependency, loaded through `import()`.

*Why:* the tedious, defect-prone parts of a `.docx` are exactly the parts a library has already
got right — `[Content_Types].xml`, the relationship graph, `styles.xml`, and `numbering.xml` for
nested ordered lists. Writing those by hand is where "Word offers to repair this document" comes
from. Two capabilities were verified directly against the published package rather than assumed:

- **`SvgMediaOptions`** — `{ type: "svg", data, fallback: RegularImageOptions }`. SVG-with-raster-
  fallback is first-class, and the fallback is **required by the type**, which matches how Word
  itself writes SVG (`a:blip r:embed` → raster, `a:extLst` → `asvg:svgBlip`). D4 depends on this.
- **A full OMML builder family** — `MathFraction`, `MathRadical`, `MathIntegral`, `MathSum`,
  `MathSuperScript`, `MathSubScript`, `MathSubSuperScript`, `MathLimitLower/Upper`,
  `MathRoundBrackets`, `MathRun`, and the rest. D3 targets these instead of raw XML strings.
- `ImportedXmlComponent` exists as an escape hatch if some construct needs raw OOXML.

*Alternatives:* hand-written parts plus a zip writer (`fflate`, or the browser's
`CompressionStream("deflate-raw")`) — rejected on scope: numbering and styles alone outweigh the
dependency. Kept as the stated fallback if a library limit is hit.

*Cost accepted:* `docx` pulls `jszip`, `xml-js` and `nanoid`. All of it lands in the export chunk,
never in the main bundle.

### D3 — Equations: KaTeX MathML → OMML, transformed over the subset KaTeX actually emits

Call `katex.renderToString(tex, { output: "mathml", displayMode })` directly, take the MathML, and
transform it to OMML with `docx`'s Math builders.

*Why direct rather than scraping the rendered page:* the export must work from text, not from a
mounted DOM (D1). Calling KaTeX gives a clean MathML tree per equation with no DOM involved. This
promotes `katex` to a **direct** UI dependency — today it is only transitive through `rehype-katex`,
which is a version we do not control.

*Why a hand-written transform:* KaTeX emits a small, enumerable subset — `mi mn mo mrow msup msub
msubsup mfrac msqrt mroot mtable mtr mtd mover munder munderover mtext mspace mstyle mpadded
menclose mphantom`. A transform over a bounded set is tractable and, more importantly, testable
element by element. The one published option, `mathml2omml@0.5.0`, is **LGPL-3.0-or-later** and at
`0.5.0`; LGPL in a bundled browser artefact is a licensing question this project should not take on
casually for one feature. It remains useful as a **test oracle** — comparing our output against it
on a corpus is a legitimate use that does not ship its code.

*Why OMML rather than images (the choice made explicitly):* an inline equation rendered as an image
cannot sit correctly on the text baseline — Word has no `vertical-align` for an inline picture, so
subscripts and fractions hang wrong. OMML is text to Word, so baselines, font size and colour all
follow the paragraph. It is also selectable, searchable and editable. The cost is that coverage gaps
are *silent* — a wrong equation, not a missing one — which is why the fallback below is not
optional.

*Fallback:* any element outside the covered subset aborts that one equation, which is then written
as its LaTeX source in a monospace run. Local failure, per the spec.

### D4 — Diagrams: re-render mermaid for the export rather than plumbing the on-screen SVG out

The export calls mermaid itself (through the same lazy loader pattern) on each `mermaid` code
fence, and rasterises the result for the fallback blip.

*Why not reuse the rendered SVG:* it lives in `Mermaid` component state, reachable only from a
mounted subtree — and the export must work in `source` mode, where no diagram is mounted at all.
Re-rendering is both simpler and mode-independent. `Mermaid.tsx` therefore needs no change at all;
only its `loadMermaid` and `naturalWidth` patterns are reused.

**Rasterisation** is serialize → `Image` → `canvas.drawImage` → `toBlob("image/png")`, at a
multiplied pixel ratio so the fallback is not soft.

Two concrete hazards drove the details:

- **`foreignObject` does not render** when an SVG is drawn through an `<img>`. Mermaid uses
  `foreignObject` for flowchart labels when `htmlLabels` is on, so the naive route yields diagrams
  with **every label blank**. The export therefore initialises mermaid with `htmlLabels: false`, so
  labels are real SVG `<text>`.
- **`width="100%"`** must be replaced with the concrete `viewBox` dimensions before rasterising, or
  the drawn bitmap has no intrinsic size. `naturalWidth()` already does this arithmetic.

**Sizing:** diagram pixels → points at 96 dpi → EMU at 12700 EMU/pt, clamped to the text width of a
Letter page with one-inch margins (6.5 in = 5 943 600 EMU), aspect ratio preserved.

### D5 — Module layout and the chunk boundary

New `ui/src/export/` — `docxExport.ts` (the entry, `downloadDocx()`), `markdownToDocx.ts` (mdast
walk), `mathmlToOmml.ts`, `mermaidToImage.ts`. `FileViewer` reaches them only through
`await import("../export/docxExport")` inside the click handler, exactly as `downloadXlsx` does.

`save()` is currently private to `tableExport.ts`. Extract it to `ui/src/util/download.ts` and have
both call it — one place that hands the browser a file, rather than a second copy that drifts.

### D6 — Non-Markdown text bypasses the pipeline entirely

Split on newlines; one monospace paragraph per line, with `xml:space="preserve"` so leading
indentation survives. No mdast, no KaTeX, no mermaid — a `.log` containing `# ` or `$` must not
acquire a heading or an equation, which is a spec requirement and is met by not running the parser
at all rather than by escaping afterwards.

## Risks / Trade-offs

- **Mermaid's `initialize()` is global module state** (`initializedTheme` in `Mermaid.tsx` is a
  module-level singleton). Rendering export diagrams with different options — `htmlLabels: false`,
  and a light theme for a white page — mutates the same instance the screen uses. → Serialise
  export rendering behind a single in-flight guard, restore the previous configuration when done,
  and treat the export's mermaid use as a critical section. If interference proves observable, the
  fallback is rendering diagrams in an offscreen iframe with its own mermaid instance.
- **OMML coverage gaps are silent** — a mis-transformed equation looks like an equation. → Test
  element by element over the KaTeX subset, and diff against `mathml2omml` as an oracle on a corpus
  of real formulas. This is the risk most likely to reach a reader unnoticed.
- **Canvas rasterisation is environment-sensitive** — fonts resolve at draw time from the system, so
  the PNG may not match the SVG glyph for glyph. → Accepted: the PNG is a fallback, not the primary.
  Any external reference would additionally taint the canvas and make `toBlob` throw; mermaid at
  `securityLevel: "strict"` produces self-contained output, and the diagram falls back to source
  text if it throws anyway.
- **"Opens without repair" is not unit-testable.** A green suite over a malformed package proves
  nothing. → Automated: unzip the output and assert every relationship resolves to a present part
  and every part has a content type. Manual: open in real Word, and in one reader without SVG
  support to confirm the fallback path. Both belong in `tasks.md`.
- **A new dependency in a bundled, offline-capable product.** `docx` + `katex` + `jszip` is real
  weight. → Confined to a dynamically imported chunk; the main bundle is unchanged, and a session
  that never exports never fetches it. Worth measuring the chunk once and recording the number.
- **The `file` spec now points at `docx-export`.** Two capabilities describing one button can drift.
  → The viewer spec deliberately states only *when the affordance is offered*; everything about
  *what comes out* lives in `docx-export` and is not restated.

## Migration Plan

Additive and self-contained: a new action in the viewer, new modules behind a dynamic import, two
new dependencies used only there. No protocol change, no server change, no persisted state, no data
migration. Rollback is reverting the change — nothing produced by it is stored anywhere, since the
export is a download and the workspace is never written to.

## Open Questions

- Page geometry is fixed at Letter with one-inch margins (D4). Whether to offer A4, or follow a
  locale, can be decided later without touching the specs or the module boundaries.
- Whether to ship a Word style template (fonts, heading colours) rather than relying on Word's
  defaults. Purely presentational, and additive to `styles.xml` afterwards.
