# Live run (task 5.3, 2026-10-11)

**Setup:** `openwebui/deploy/docker-compose.yml` as written, with:
- Open WebUI v0.11.4 on `127.0.0.1:3010`;
- the image built from this branch, and two templates in `./templates` (`acme-report.dotx`, a French
  Word template, and `acme-deck.potx`);
- `codestral-latest` through Mistral's API, the pi-outpost tools attached to the model, native
  function calling;
- requests typed into the chat in French, the files downloaded from the card
  (`scripts/probes/owui-live-documents.mts`).

The user had already opened the documents written by the server in Office web: correct.

## What the model did

| Request | Tool calls | Result |
|---|---|---|
| A Word report on a mail migration: title, introduction, a risk table, a Mermaid diagram of the cut-over, an architecture diagram | `create_document`, once | Written: headings, a native table, the Mermaid flowchart (with its "Non" loop back) and a structured-exchange graph (clients, old and new servers, directory), both as SVG with a PNG. The card showed the outline and both figures. |
| A PowerPoint deck for a steering committee: title, progress bullets, a budget column chart, a sequence, a Mermaid release cycle | `create_presentation`, once | Five slides: a native chart with the figures given, the sequence as a structured-exchange figure, the Mermaid slide. **But the bullets and the Mermaid diagram were the tool description's example, translated** (see fix 2). After the fix: the model's own content. |
| "Use the company's Word template" for a memo | `list_templates`, then `create_document` with `acme-report.dotx` and `keep: ["cover", "toc"]` | Written in the template's own French styles (`Titre`, `Titre1`). The model dated the memo 2023 (its own knowledge, not the tools). |
| A Word "charte graphique" with "our logo, it is here: https://example.com/logo.png" | `create_document` with the URL as a picture | **Refused** (422), as specified, and nothing written. The model **did not call again without the picture**: it asked the user to provide the logo "as a data URI". See below. |

## Fixes made from it

1. **The card was cut off at the bottom.** The frame's height is measured from `#root`, and the
   card's own margin did not count in it: padding on a wrapper instead (`DownloadCard.tsx`).
2. **Examples were copied into real documents.** The deck's progress slide and Mermaid diagram came
   from the description's "rollout review" example, translated. The examples are now about an
   allotment society (unrelated to any work request), and each description says to write the user's
   own content and never the example's.
3. **Labels wrapped too early.** In the image, Mermaid broke "Développe|ment" across two lines. Mermaid
   in a real Chrome does the same with DejaVu Sans, which is wider than Arial; with Helvetica it does
   not. The image now installs Liberation Sans (Arial's metrics) and lays out in it, so Word on Windows,
   which draws the SVG in Arial, gets exactly the widths it was laid out at.
4. **The picture refusal speaks to the model**, and for a web address says to remove the picture,
   call again and tell the user. Codestral still asked the user instead, twice: it does not retry
   after this refusal. Left as found (see below).

## In ONLYOFFICE (the user's reader)

The user reported a deck looking empty in ONLYOFFICE. Not reproduced: the package is sound, and
ONLYOFFICE's own converter (`x2t`, with the user's font database) draws all five slides with their
content. (Keynote's scripted export draws no text for any of these decks, ONLYOFFICE's own re-save
included: that is Keynote, not the file.) The render did show two defects, fixed:

1. **Mermaid labels drawn a line too high, and words drawn over each other.** ONLYOFFICE ignores `em`
   positions, the `dy` of a line that also has a `y`, and `dominant-baseline: central`, and starts each
   word's `tspan` at the line's position. The SVG put in the file now places every line in pixels,
   folds `dy` into `y`, turns a central baseline into its shift, and joins a line's words when they
   all look alike (`explicitBaselines` in `mermaidWorker.ts`). Browsers draw it as before.
2. **Structured-exchange figures in a serif face.** ONLYOFFICE reads only the first family of a font
   list and knows no `system-ui`. In a file, the figure's list starts with Arial (`forOfficeReaders`);
   on screen it is unchanged. The figure's own list also names real faces after `system-ui` now.

## Open: a picture given as a web address

The specification refuses the call so the model can correct it; Codestral answers the user instead
("fournissez le logo sous forme de données URI"), which a user cannot act on. Writing the document
without the picture, and saying on the card which picture was left out and why, would serve the user
better, since the model cannot fetch it either. That changes `AURLPictureIsNotFetched`, and is the
user's call.

## Destructive pass

Covered by the route tests rather than repeated live: invalid Mermaid, an SVG picture, a mislabelled
picture, a path as a template name, a Word template for a deck, an oversized result, an unsigned call
(`openwebui/test/documents.test.ts`). In the image, `image.sh` writes a document with a
structured-exchange graph, a Mermaid diagram and a picture, and refuses a raster whose text could not
be drawn.

**Files written under `/data` during all of it: none.**
