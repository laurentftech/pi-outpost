## Why

A document read in this application can be copied, edited and saved, but it cannot be *taken
away* in the form the people who asked for it expect. A specification, a report or a design note
written as Markdown is read here with its headings, tables, diagrams and equations rendered — and
then has to be pasted into Word by hand, losing every one of them, whenever it goes to someone who
does not open a repository.

The table export already answers exactly this need for one kind of content: a reader who wants to
keep a table wants it where they keep tables. The same argument applies to a document, and the
destination is Word.

## What Changes

- The file viewer gains a **download-as-Word action** for any loaded text file. The result is a
  real `.docx` — an Office Open XML package — named after the source (`README.md` → `README.docx`),
  handed to the browser as a download. Nothing is written into the workspace.
- **Markdown becomes Word structure, not Word-shaped text.** Headings become heading styles, lists
  become lists (nested and ordered included), GFM tables become Word tables, and emphasis, strong,
  strikethrough, links and inline code become the runs that carry them. Fenced code becomes a
  monospace block.
- **LaTeX equations become native Word equations.** KaTeX already emits MathML alongside its visual
  output; that MathML is transformed to OMML, Word's own equation format. Equations are therefore
  selectable, editable and typeset by Word — and inline equations sit correctly on the text
  baseline, which an image of an equation cannot do.
- **Mermaid diagrams become pictures that stay sharp.** Each diagram is embedded as SVG using the
  `svgBlip` extension, with a rasterised PNG beside it as the fallback blip. Word draws the vector;
  readers that do not know the extension — LibreOffice, Google Docs, Pages, older Word — draw the
  PNG rather than a broken image.
- **A non-Markdown text file exports too**, as monospace paragraphs preserving its lines. A `.log`,
  a `.ts` or a `.txt` is a document someone may need to send onward as well.
- Conversion happens **in the browser**, in a chunk loaded on demand, so a reader who never exports
  does not download a document writer. This follows the precedent set by the workbook export.
- The action is **not** offered where it would be meaningless or misleading: images, PDFs, files
  that failed to load, and the uncommitted-diff view.

## Capabilities

### New Capabilities
- `docx-export`: producing a Word document from a text document displayed in the viewer — the
  package that is written, how Markdown structure is mapped onto Word structure, how equations and
  diagrams are carried, what the file is named, and what happens when a document is too large or a
  figure cannot be produced.

### Modified Capabilities
- `file`: `FullSizeFileViewer` gains the download-as-Word affordance and states the conditions
  under which the viewer offers it — which is viewer behaviour, not merely an implementation
  detail, and belongs beside the Edit and lock affordances already specified there.

## Impact

**Affected code**
- `ui/src/components/FileViewer.tsx` — the toolbar affordance and its enabling conditions.
- `ui/src/export/` — new modules for the conversion: the Markdown-to-document mapping, the
  MathML→OMML transform, and the mermaid rendering and rasterisation for the fallback blip.
- `ui/src/util/download.ts` — the blob-to-browser helper, extracted from `tableExport.ts` so the
  two exports share one way of handing over a file rather than keeping a copy each.
- `ui/src/components/Mermaid.tsx` is **not** modified: the export re-renders diagrams from their
  source rather than reaching into component state, which is also what lets it work in source
  mode where no diagram is mounted. See `design.md` — D4.

**Dependencies**
- A new UI dependency for writing the OOXML package (a document writer, or a zip writer plus
  hand-written parts), loaded through `import()` so it lands in its own chunk. `server/src/zip.ts`
  reads archives only and is server-side, so it is not a candidate.
- No new server dependency, no new route, no new agent tool. The existing `docx-documents`
  capability reads Word documents and is untouched by this change: reading and writing stay
  separate capabilities.

**Not in scope**
- Writing the `.docx` into the workspace, and any agent-callable export tool.
- Exporting a structured-exchange document as a Word rendering of its narrative.
- Importing a `.docx` back, or round-tripping an exported document without loss.
