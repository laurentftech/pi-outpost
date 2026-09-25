# Scenario coverage — word-headings-are-outline-levels

Capability: `docx-export` — one added requirement, `HeadingsAreChapterLevels` (1 scenario).

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| HeadingsAreChapterLevels | covered | `ui/src/export/markdownStructure.test.ts` — "HeadingsAreChapterLevels: each heading style declares its outline level". Exports a document with headings and body text through `buildDocx`, opens `word/styles.xml` and asserts, for each of `Heading1`…`Heading6`, `<w:outlineLvl w:val="depth − 1"/>` and that the style keeps its `w:color` run property; asserts `Normal` has no `w:outlineLvl`, and that the heading paragraphs reference `Heading2`/`Heading6`. Fails on the code before this change at the first `outlineLvl` assertion. |

The boundary is the package Word opens: the level is read where Word reads it, on the
style, not inferred from the paragraph's style name.
