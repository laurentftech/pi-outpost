---
name: pptx-from-template
description: Build a PowerPoint presentation (.pptx) from a template (.potx or .pptx) with pptx_layouts, pptx_create and pptx_render, then check it is readable by rendering it with PowerPoint (Windows), LibreOffice or ONLYOFFICE and fixing what the render shows. Use whenever the user asks for a deck, slides or a presentation made from a template, a corporate/brand deck, or to turn a document, notes or an outline into slides — and whenever a .potx file is involved.
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
| Build the deck | `pptx_create` |
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
- **The template's own sample slides are not carried over.** Only its layouts, masters, theme
  and fonts are.

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

Charts, tables, speaker notes, animations and transitions are not written. SmartArt, icons and
decorative shapes come only from the template's layouts. If the user needs one of these, build
the rest and say what is missing rather than faking it with text.
