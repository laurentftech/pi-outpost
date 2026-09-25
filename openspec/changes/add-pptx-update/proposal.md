# Update an existing PowerPoint deck

## Why

`pptx_create` builds a deck from a template, and `docx_update` (change `add-docx-from-template`)
maintains a Word document. Decks are maintained too — a figure to refresh, a slide to add before
the conclusion, an obsolete one to drop — and today the agent's only way is to rebuild the whole
deck, which loses every hand edit made since.

## What Changes

- **`pptx_update`** changes an existing `.pptx` slide by slide, the deck being its own template:
  - replace a slide's content (title, bullets, picture, table or chart) in the slide's own
    placeholders, keeping its layout;
  - insert a new slide after another, on one of the deck's own layouts;
  - delete a slide; move a slide.
- Slides are addressed by number, as `pptx_extract` shows them, or by title; an unknown or
  ambiguous title is refused with the list of slides.
- **Untouched slides stay identical**, byte for byte, with every part they use.
- No tracked changes (not needed for decks). As with `pptx_create`, the original is replaced only
  with `overwrite: true`; the call reports which slides changed, so the agent renders exactly
  those to check them (`pptx_render` gains a `slides` selection).

## Impact

- Capability `pptx-presentations` (from `add-pptx-from-template`): two added requirements.
- Capability `agent`: `pptx_update` joins the presentation tools' publication.
- Server: `pptxUpdate.ts` beside `pptxBuild.ts`, reusing its placeholder writing, picture,
  table and chart code and its reachability sweep.
