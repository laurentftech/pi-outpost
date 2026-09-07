# Verification against real documents

The fixtures are generated, so they can only prove the reader does what the
generator asked for. These are the checks against files no one here wrote: a
Word-authored `.docx`, the PDF Word printed from it, and an unrelated document
that contains no strikethrough at all.

## The Word `.docx`

`barré.docx`, authored in Microsoft Word, three struck passages.

What Word actually wrote — worth recording, because it decides the reader's
shape:

```
   3  <w:b />
   2  <w:b w:val="1" />
   5  <w:strike w:val="1" />
```

Word writes the *on* case as `w:val="1"`, not as the bare `<w:strike/>` every
example in the OOXML documentation shows. A reader testing for the element's
presence would have worked here by accident; one testing `w:val` for truth would
have failed on the bare form. Both spellings occur, which is why `toggleOn`
reads the value rather than the element (design.md D2).

Extraction:

```
# Prise en main

~~Copiez l’une des requêtes ci-dessous.~~

**Requête :** Crée un premier brouillon d’itinéraire de voyage …

# ~~Rédige une lettre de motivation~~
```

A struck paragraph, a struck heading, and a struck run inside a paragraph, all
marked. Bold survives alongside strikethrough on the same run.

## The PDF Word printed from it

`barré.pdf`, `/Creator (Microsoft Word)`, the same three passages struck.

The measurements the thresholds came from, after composing the CTM:

| shape | x range | y | height | baseline | offset ÷ size | verdict |
|---|---|---|---|---|---|---|
| filled | 90.1 → 99.1 | 599.0 | 0.5 | 595.4 (10 pt) | +0.36 | strike |
| filled | 99.1 → 108.1 | 597.7 | 0.5 | 595.4 | +0.23 | strike (the tab) |
| filled | 108.1 → 272.6 | 598.5 | 0.5 | 595.4 | +0.31 | strike |
| filled | 490.7 → 535.7 | 657.0 | 0.25 | 657.7 (10 pt) | −0.07 | underline (hyperlink) |
| filled | 72 → 237.4 | 643.7 | 0.25 | 644.5 | −0.08 | underline (hyperlink) |
| filled | 161.3 → 276.4 | 107.0 | 0.5 | 108.3 | −0.13 | underline (hyperlink) |
| stroked | 72 → 548.3 | 475.6 / 158 | 0 | — | — | page rule |

Extraction, after the change:

```
Prise en main
~~1.~~ ~~Copiez l’une des requêtes ci-dessous.~~
2. Supprimez les autres requêtes ou enregistrez-les …

Crée votre itinéraire de voyage
~~Requête :~~ Crée un premier brouillon d’itinéraire de voyage …

~~Rédige une lettre de motivation~~
```

All three strikes found. The three hyperlink underlines and the two page rules
mark nothing.

Two observations worth keeping:

- The numbered line comes back as two spans, `~~1.~~ ~~Copiez …~~`, because the
  number and the text are far enough apart to be separate cells — the same gap
  that separates table columns. Both halves are struck and both say so; merging
  across that gap would mean merging across a potential column boundary.
- The same passage differs between the two files: the `.docx` says
  `~~**Requête**~~ **:**` and the PDF says `~~Requête :~~`. Word did not put
  `w:strike` on the run holding the colon, but did draw the rectangle across it.
  Each reader is faithful to its own source; the inconsistency is Word's.

## A document with no strikethrough

`Proposition atelier jeux CM2-6ème.docx`, an unrelated file, 50 paragraphs,
`w:strike` count zero.

Extraction contains no `~~` at all. It does now contain bold, and on exactly the
lines that were serving as headings:

```
**Genèse de l’idée :**   **Déroulé**   **Intérêt pédagogique**
**Propositions pour la mise en place de l’atelier**
**Besoins humains**   **Besoins matériels**
```

That document declares no heading style anywhere — its only `w:pStyle` is
`Paragraphedeliste`, 23 times — so before this change its structure was
invisible and the model received an undifferentiated wall of paragraphs. This is
the case that justifies carrying bold across, and it is why the extra `*`
characters in unrelated prose are worth their cost.

## In the running app — the check that found a defect

Markers in the output are not the same thing as a model that reports them. Asked to read the Word
document aloud, the agent transcribed the struck sentence as ordinary text and said nothing about
it. Asked immediately afterwards whether anything was crossed out, it found it.

So the mechanism was right and the behaviour was not — the failure this project's own guidance says
unit tests cannot see. Two changes followed:

- the extraction now opens with a line naming how many passages are struck and what the markers
  mean, before any of the document's text, because a note at the end arrives after the answer has
  been written;
- both tool descriptions now say to report struck passages when transcribing, quoting or
  summarising, not merely to avoid treating them as current.

This has to be re-observed in the running app; a test in this repository can only prove the notice
is emitted and placed first, never that a model acts on it.

## Cost of the second read

`getOperatorList()` is a second pass over the same content stream. Median of
five runs, per document, text extraction only versus text plus drawing:

| document | text only | text + drawing | added |
|---|---|---|---|
| `pdf-long.pdf` (10 synthetic pages) | 4.9 ms | 6.8 ms | +1.9 ms (×1.40) |
| `barré.pdf` (1 real Word page) | 21.7 ms | 63.4 ms | +41.8 ms (×2.93) |

The real page costs more than the synthetic ones because it carries images,
marked content and embedded fonts — the operator list has something in it. At
63 ms a page, the default 20-page cap comes to roughly 1.3 s against a 30 s
budget, so the headroom class is unchanged.
