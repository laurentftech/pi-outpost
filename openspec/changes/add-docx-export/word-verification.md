# Verification in real Microsoft Word

Three scenarios in `docx-export` are claims about what *Word* does with the package —
`WordOpensItWithoutRepair`, `EquationIsEditableInWord` and `DiagramIsVectorInWord`. No test in
this repository can settle them: a package can satisfy every structural assertion we make and still
draw a repair dialog, and "the equation is editable" is a statement about Word's object model, not
about our XML.

So the file was opened in Word itself and Word was asked what it found.

## How

Word 2016 (`Office16`, French UI) driven over COM, on Windows 11, 2026-09-06. The document was
produced by the real export path — the browser harness at `e2e/host/export-main.ts` calling
`buildDocx` in Chromium — from a source exercising headings, bold and italic, an inline equation, a
display equation, a sum, a root, a mermaid diagram, a GFM table, an ordered list, a block quote and
a link.

The document is opened with `OpenNoRepairDialog: true`. That flag is the whole point: with it, a
damaged package raises an error instead of being silently repaired, so "it opened" means the
package was sound rather than that Word rescued it.

```powershell
$doc = $word.Documents.Open($file, [ref]$false, [ref]$true, [ref]$false, [ref]"", [ref]"", [ref]$true)
```

## What Word reported

```
OPENED-NO-REPAIR: yes
OMATHS: 4
TABLES: 1  ROWS: 3
INLINESHAPES: 1
SHAPE-TYPE: 17  W: 111.8pt  H: 197.2pt
HYPERLINK: https://example.com/guide
EQ1: 400𝑉
EQ2: 𝑃𝑉=𝐼
EQ3: 𝑖=1𝑛𝑥𝑖
EQ4: 𝑎2+𝑏2
STYLES: Titre 1 | Normal | Paragraphe de liste
```

## What each line settles

**`WordOpensItWithoutRepair`** — `OPENED-NO-REPAIR: yes`. Word opened the package with the repair
dialog suppressed and raised nothing, so it was not damaged.

**`EquationIsEditableInWord`** — `OMATHS: 4`. `Document.OMaths` is Word's collection of *equation
objects*; an image of an equation or a run of literal text contributes nothing to it. All four
equations in the source are there, and reading each one back gives typeset mathematics
(`𝑃𝑉=𝐼`, with Word's own math italics) rather than the LaTeX that produced it. They are equations
Word owns, not pictures.

**`DiagramIsVectorInWord`** — `SHAPE-TYPE: 17`. In `WdInlineShapeType`, 17 is
`wdInlineShapeScalableVectorGraphic`. Word is telling us it is rendering the **SVG**, not the PNG
fallback beside it. A raster would report `wdInlineShapePicture` (3).

Incidentally confirmed, though covered by tests elsewhere: the heading style resolved (as
`Titre 1` — this is a localised Word, which is a fair check that the style was referenced properly
rather than named in English by luck), the table arrived with its three rows, the ordered list
carried Word's own `Paragraphe de liste` style, and the hyperlink resolved to its address.

## Verification in LibreOffice

LibreOffice 26.8.0.3, same machine and date, converting the same document headlessly to an image
and reading it.

It turned out **not** to be the reader the design expected. LibreOffice does not ignore the SVG
extension and fall back to the raster: it follows the extension and draws the vector. That made it
a far more useful test than a reader that simply took the PNG, because it exercises the vector on a
renderer that is not Word — and it found three defects that every test we had was blind to.

**The diagram arrived as a solid black block.** A mermaid SVG carries a 5 kB `<style>` element and
styles all 58 of its shapes through class selectors; not one shape has a `fill` of its own. A
browser runs that CSS, so the picture looked right on screen and the raster drawn from it was right
too. LibreOffice does not run CSS inside an SVG, so every shape fell back to the default fill.
Worse than a missing image, and the raster fallback was never reached because the reader had
already chosen the vector. Fixed by resolving the styles in the browser — where they can be
resolved — and writing them onto each element as presentation attributes, so the vector depends on
no stylesheet at all. Asserted by `e2e/docx-export.spec.ts` ("the embedded vector carries its own
appearance, not a stylesheet").

**The first node of every diagram was drawn at the height of the whole picture.** Our own bug, and
not LibreOffice's: `withExplicitSize` replaced the first `height="…"` in the file, and a mermaid
root declares `width="100%"` with *no* height — so the first match belonged to a child rect. The
raster was corrupted identically, which is why no reader could have shown it correctly. Now only
the opening `<svg>` tag is rewritten. Asserted by `ui/src/export/mermaidToImage.test.ts` ("leaves
the geometry of the drawing alone").

**Every sum and integral showed an empty-slot placeholder** — `Σ □ xᵢ`. Word's n-ary object owns
its operand, and MathML supplies the operand as a *sibling* of the scripted sign; we left the slot
empty. Word hides an empty slot, so this was invisible in the Word check above. Fixed by having the
n-ary operator take the rest of its row as its operand. Asserted by
`ui/src/export/mathmlToOmml.test.ts` ("gives the n-ary operator the thing it operates on").

After those three fixes LibreOffice renders the document correctly: the diagram with its own
colours, properly sized boxes and arrows between them; the heading, the table, the ordered list,
the block quote and the link; and all four equations, the sum with its operand. Word was
re-checked afterwards and is unchanged — no repair, `OMATHS: 4`, `SHAPE-TYPE: 17`.

`OtherReadersSeeThePicture` — a reader that supports *neither* the SVG extension nor its CSS, and
therefore draws the PNG — still has no direct observation, because the one non-Word reader to hand
turned out to support the extension. The mechanism is asserted in `e2e/docx-export.spec.ts` ("a
reader without SVG support is pointed at the raster, not at nothing"): the `<a:blip r:embed>`
resolves to the **PNG**, and the SVG is reached only through the
`{96DAC541-7B7A-43D3-8B79-37D633B846F1}` extension beside it, so a reader that skips the extension
draws the raster. Swapping the two would fail that test.
