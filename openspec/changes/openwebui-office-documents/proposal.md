# Proposal

## Why

In Open WebUI, the tool server shows plannings, diagrams, sequences and tables, and the reader can take
a diagram away as SVG and a table as XLSX. What a user cannot get is the deliverable itself: a Word
report or a PowerPoint deck. pi-outpost's agent writes both, in a template's styles, with its figures.
The builders are TypeScript with no Office, no LibreOffice and no browser, and structured-exchange
figures are already drawn as SVG without a browser (`figureForDocument` + `serializeFigure`). So the
cost is moving those builders where the tool server can use them, and handing the file to the user.

## What Changes

- **Three new tools on the Open WebUI server:**
  - `create_document`: a Word document (`.docx`) from Markdown, written in a template's styles;
  - `create_presentation`: a PowerPoint deck (`.pptx`) from a list of slides (title, bullets, native
    table, native chart);
  - `list_templates`: the templates the administrator provides, with what each offers.
- **Diagrams in both.** A structured-exchange document — graph, sequence or timeline, of any version,
  proposals included — is drawn as a figure:
  - in `create_document`, as a ` ```json ` fence in the Markdown, exactly as in a pi-outpost reply;
  - in `create_presentation`, as a slide's `diagram`.

  Each is judged by the same gate as `show_structure` and drawn by the same figure code, as a vector
  picture with a raster behind it. One refused diagram refuses the whole call with its diagnostics,
  so the model corrects it and calls again.
- **The file is handed over in the chat.** The answer is an embed, like `show_structure`'s. It shows the
  file's name, its outline (headings or slide titles) and its figures, with a download button. The
  file travels inside the embed; the server stores nothing.
- **Templates:**
  - with no template named, a built-in default (Office's own theme). PowerPoint already has one; Word
    gets one, generated the same way;
  - an administrator may mount a folder of `.dotx`/`.docx`/`.potx`/`.pptx` templates
    (`OUTPOST_TEMPLATES_DIR`). The model names one by its file name, never by a path.
- **The builders move to a workspace package** (`@pi-outpost/office`), which pi-outpost's server and the
  Open WebUI server both import. pi-outpost's tools behave exactly as before.

**Out of scope, for later changes:**
- changing a document the user uploaded (`docx_update`, `pptx_update`): the tool server never sees the
  chat's files;
- checking pages visually (`docx_render`, `pptx_render`): needs LibreOffice in the image;
- Mermaid diagrams and pictures: no browser to draw Mermaid, no workspace to read pictures from. A
  Mermaid fence stays its source, and the description steers the model to a structured-exchange diagram;
- keeping files on the server to download again later.

## Capabilities

### New Capabilities

- `openwebui-office-documents`: creating Word documents and PowerPoint decks, with structured-exchange
  diagrams, from an Open WebUI chat, in a built-in or administrator-provided template, handed to the
  user as a download in the chat.

### Modified Capabilities

None. `docx-templates`, `pptx-presentations` and the structured-exchange contract are reused unchanged;
moving the builders into a package is not a behaviour change, and pi-outpost's existing tests guard it.

## Impact

- **New package `office/`** (`@pi-outpost/office`): the Word and PowerPoint builders and what they need
  (`zip`, `zipWriter`, `xml`, `ooxml`, `wordml`, `docxTemplate`, `docxGraft`, `docxBuild`, `pptxBuild`,
  `pptxVisuals`, `imageInfo`, `markdownTable`, `defaultTemplate`), plus the new default Word template.
  `server/src` imports them from there.
- **`openwebui/src`:** three routes, their OpenAPI descriptions, the template folder, a size limit.
- **`openwebui/viewer`:** a third mode, `download`.
- **Image:** `@pi-outpost/office` is bundled. `@napi-rs/canvas` and one font family are added for the
  raster behind each figure; the image size before and after is measured.
- **Docs:** `docs/openwebui.md`, `docs/openwebui-architecture.md`, `openwebui/deploy/.env.example`.
