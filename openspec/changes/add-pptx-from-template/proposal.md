## Why

The agent can read a PowerPoint deck (`pptx_extract`) but cannot make one. People who work in
organisations with a corporate template — most of those who run this on Windows — are asked for
decks all the time: turn this report into slides, make the steering-committee deck, same template
as last quarter. Today the agent can only hand back an outline to paste by hand, losing the
template's layouts, fonts and colours on the way.

Writing a deck is also the kind of output whose defects cannot be seen in what was written. A
title that wraps to three lines, bullets that run off the bottom of the slide, a picture drawn over
the text: the markup is fine and the slide is unreadable. An agent that writes a deck without
looking at it hands over its first draft, overflow included. It has to see the slides the way
the audience will, and fix them, before calling the deck done.

## What Changes

- **`pptx_layouts`** lists a template's slide layouts (`.potx` or `.pptx`): name, type and the
  placeholders each offers (title, subtitle, content, text, picture), plus the slide size.
- **`pptx_create`** builds a new `.pptx` from the template. Each slide names a layout (or lets the
  tool choose from its content), and its title, subtitle, bullets and picture are written into that
  layout's **placeholders**, so the template's fonts, colours, positions and bullet styles apply.
  The template's own sample slides are left out, together with everything only they used.
  Pictures may be PNG, JPEG, GIF or **SVG** — an SVG is embedded as SVG for PowerPoint 2016 and
  later, with a PNG rendering beside it for every other reader. A slide may instead carry a
  **native table** (the template's table style, figures right-aligned) or a **native chart** —
  column, bar, line or pie, stacked or not, in the theme's accent colours, its data in an embedded
  workbook so PowerPoint's *Edit Data* works.
- **`pptx_render`** draws a deck with a real office application and gives the agent a **picture of
  each slide**, plus a **text check**: every paragraph that is on a slide but not visible on the
  rendered page (overflow, clipping) and any text drawn at the slide's edge. It can also save the
  rendering as a PDF. The application is, in `auto` order: **PowerPoint on Windows** (through COM
  automation from PowerShell), **LibreOffice**, then **ONLYOFFICE Document Builder**.
- A shipped skill, **`pptx-from-template`**, teaches the loop — read the template, plan the deck,
  create, render, look, fix, rebuild — modelled on the structure of Anthropic's public `pptx` skill
  and written for these tools.
- The three tools are **published on demand**, like the extractors: when a prompt names a `.potx`
  or `.pptx`, when the user invokes the skill, or when the agent reads the skill or reaches a
  template on its own. `pptx_create` is registered only where writing is allowed.
- Configuration gains `pptx.renderer`, `pptx.libreofficePath`, `pptx.onlyofficePath` and
  `pptx.renderTimeoutMs`.

## Capabilities

### New Capabilities

- `pptx-presentations`: building a PowerPoint deck from a template and rendering it for review.

### Modified Capabilities

- `agent`: the presentation tools join the on-demand tool set, with triggers of their own.
- `config`: the renderer and its executables.

## Impact

- New: `server/src/pptxBuild.ts`, `pptxVisuals.ts`, `presentationRender.ts`, `presentationTools.ts`,
  `imageInfo.ts`, `zipWriter.ts`; `skills/pptx-from-template/SKILL.md`.
- Changed: `zip.ts` (read every entry, with a total budget), `pptx.ts` (each slide's paragraphs,
  for the text check), `documentTools.ts`, `sandbox.ts`, `workspace.ts`, `index.ts`,
  `piOutpostTools.ts`, `config.ts`.
- No new dependency. `@napi-rs/canvas`, already present as pdf.js's optional dependency, draws the
  slide pictures and SVG fallbacks; where it is missing, the text check still runs and the tool says
  that pictures are unavailable.
- External programs are run only by `pptx_render`, only from configured or conventional locations,
  never through a shell, and never on the user's own file.
- Documentation: `README.md`, `docs/how-to.md`, `pi-outpost.config.example.json`,
  `skills/README.md`.
