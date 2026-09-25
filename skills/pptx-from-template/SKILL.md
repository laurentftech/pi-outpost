---
name: pptx-from-template
description: Build a PowerPoint presentation (.pptx) from a template (.potx or .pptx) — titles, bullets, pictures, native tables and editable charts — or update an existing deck slide by slide, with pptx_layouts, pptx_create, pptx_update and pptx_render, then check it is readable by rendering it with PowerPoint (Windows), LibreOffice or ONLYOFFICE and fixing what the render shows. Use whenever the user asks for a deck, slides or a presentation made from a template, a corporate/brand deck, or to turn a document, notes or an outline into slides — and whenever a .potx file is involved.
license: MIT
metadata:
  version: "1.0"
---

# Presentations from a template

A template carries the look of a deck: slide masters, layouts, theme colours, fonts, logos.
You supply the words and pictures; pptx_create puts them into the template's **placeholders**,
so every slide takes the template's styling without you setting a single font or colour.

| Task | Tool |
|---|---|
| See which layouts a template offers | `pptx_layouts` with the template's `path` |
| Read the text of a deck or of the template's sample slides | `pptx_extract` |
| Build the deck: text, pictures, tables, charts | `pptx_create` |
| Change slides of an existing deck | `pptx_update` |
| See the slides as the audience will, and find unreadable text | `pptx_render` |
| Hand over a PDF as well | `pptx_render` with `pdf_path` |

## The loop

1. **Read the template.** Call `pptx_layouts` on it. Note the layout names and what each holds:
   `title, subtitle` is a cover or section slide, `title, content` takes bullets or a picture,
   `title, content, content` puts bullets and a picture side by side, `title, picture, text` is
   a captioned picture. If the template is a .pptx with sample slides, `pptx_extract` shows how
   its author meant each layout to be used.
2. **Plan the deck before writing it.** One idea per slide. Map each part of the source onto a
   layout, and vary them: a cover, section slides between parts, content slides, a slide with a
   picture where a picture says it better. A deck of identical title-and-bullets slides is the
   most common way to make a template look bad.
3. **Write the slides** with `pptx_create` — see [Writing slides](#writing-slides).
4. **Render and look.** Call `pptx_render` on the new deck. Read its text check first, then look
   at every picture — see [Checking the render](#checking-the-render). A first render nearly
   always shows something to fix.
5. **Fix and rebuild.** Change the slide specs — shorter text, one slide split into two, another
   layout — and call `pptx_create` again with the same `output_path` and `overwrite: true`.
   Render again, with `slides` limited to the ones you changed.
6. **Stop** when the text check is clean and nothing in the pictures is wrong. Say which
   application rendered the deck, and what you could not check.

Never declare a deck finished without having rendered it.

## Updating an existing deck

When the user asks to change a deck they already have — a figure to refresh, a slide to add,
one to drop — use `pptx_update` rather than rebuilding it: rebuilding loses every hand edit made
since. Read the deck with `pptx_extract` first to know its slides.

- Name slides by number or title, as the deck is **now**: `replace` rewrites a slide's content on
  its own layout (give `content.layout` to change it), `insert_after` adds a slide (after `0` for
  the start), `delete` removes one, `move` puts one `after` another. All edits apply together.
- `content` is a slide exactly as for `pptx_create`: title, bullets, one picture, table or chart.
- Write to a new file with `output_path`, unless the user asked to change the original
  (`overwrite: true`). Speaker notes of a replaced slide are kept.
- The answer lists the changed slides' numbers in the result: render exactly those with
  `pptx_render` and `slides`.

## Writing slides

- **Choose layouts by name** from `pptx_layouts` (`"layout": "Two Content"`). Without one, the
  tool picks from the slide's content: a cover for a first slide with no body, a content layout
  for bullets or a picture, two contents for both.
- **Titles are short** — one line when possible, never a sentence with a full stop.
- **Bullets: one string per item.** Indent a sub-item with two spaces per level (`"  detail"`).
  Never type `•`, `-` or `*` at the start: the template draws the bullet, and a typed one shows
  twice. `**Owner:** Ana` makes the label bold.
- **Keep bullets few and short**: about six per slide, a line or two each. If there is more to
  say, it is two slides. A box full to its edge in the render will overflow in someone's
  PowerPoint.
- **Pictures**: PNG, JPEG, GIF or SVG from the workspace, with `alt` text. Prefer SVG for
  diagrams and logos: it stays sharp at any size. A picture is fitted inside its box without
  being stretched. On a layout with one content placeholder, bullets and a picture share it —
  text on the left, picture on the right; a two-content layout gives each its own box.
- **One picture, table or chart per slide.** Two of them is two slides.
- **The template's own sample slides are not carried over.** Only its layouts, masters, theme
  and fonts are.

## Tables and charts

Both are native: the audience can edit them in PowerPoint, and they take the template's table
style and theme colours. Never draw a chart as a picture, and never lay out a table as bullets.

- **A table** is `"table": {"rows": [["Region", "Revenue"], ["EMEA", "€4.2M"]]}` — the first row is
  the header (`"header": false` if it is not). Keep it to what a slide can show: about six rows and
  five columns reads well; the tool refuses more than 20 rows or 10 columns. Figures are
  right-aligned automatically. A longer table is a summary on the slide and the detail in an
  appendix slide or a handout.
- **A chart** is `"chart": {"type": "column", "categories": [...], "series": [{"name": ..., "values": [...]}]}`,
  one value per category in each series. Pick the type from the message:
  - `column` — compare a few values, or show change over a few periods;
  - `bar` — compare many items, or items with long names (they read left to right);
  - `line` — a trend over many periods;
  - `pie` — parts of one whole, with at most five or six slices, one series only.
  `stacked: true` stacks column or bar series (parts adding up to a total). Set `number_format`
  (`"0%"` for fractions — 0.25 shows as 25%, `"#,##0"`, `"0.0"`) and `show_values: true` when the
  exact figures matter. Give the chart a `title` only when the slide title does not already say what
  it shows.
- **Say what the chart shows in the slide title** — "EMEA drove Q4 growth", not "Revenue by
  region". Bullets beside a chart go in a two-content layout.
- In the render, check that axis labels and data labels are readable, that category names are not
  cut or overlapping (use `bar` for long names), and that a table's last row is on the slide.

## Checking the render

The text check lists every paragraph that is on a slide but not visible on the rendered page —
text that overflowed its box or ran off the slide — and text drawn at the slide's edge. Every
entry is a defect: fix it, do not explain it away.

Then look at each picture for what no text check can see:

- text cut off, or squeezed so small it can no longer be read from the back of a room;
- elements overlapping — text over a picture, a picture over the footer;
- text with poor contrast against the template's background;
- leftover template text ("Click to edit…", "Lorem ipsum", "XXX");
- a picture too small to read, or a diagram whose labels are illegible;
- a title that wrapped where the template's decoration expects one line.

**Which application rendered the deck matters.** PowerPoint on Windows is the reference: it is
what the audience will use. LibreOffice and ONLYOFFICE replace fonts they do not have with
others of different widths, so their line breaks can differ from PowerPoint's; leave room in
every box rather than trusting a render that only just fits. LibreOffice also does not shrink
text the way PowerPoint's "shrink text on overflow" does — an overflow it shows may be hidden by
PowerPoint's autofit, but it is still a slide with too much on it.

If `pptx_render` says no office application is available, tell the user which one to install
(LibreOffice works everywhere; PowerPoint is used automatically on Windows). Without a renderer
there are neither pictures nor a text check, so do not claim the deck was checked.

## What it does not do

Speaker notes, animations and transitions are not written, and charts are limited to column, bar,
line and pie. SmartArt, icons and decorative shapes come only from the template's layouts. If the
user needs one of these, build the rest and say what is missing rather than faking it with text.
