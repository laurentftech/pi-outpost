# Skills shipped with pi-outpost

A skill teaches the agent how to use a capability this application provides. These are
part of the product, not local configuration, so they live here — `.pi/skills/` and
`.agents/skills/` are runtime locations and are deliberately not tracked.

## Loading one

Point `skillPaths` at it in your configuration:

```json
{ "skillPaths": ["<path to this repo>/skills/structured-exchange"] }
```

Or copy the directory into `.agents/skills/`, which the agent discovers on its own.

## What is here

- **`structured-exchange/`** — authoring a structured-exchange document: the envelope,
  the two identities, patch semantics, and the loop to run when a document is refused.
  Pairs with [`docs/structured-exchange.md`](../docs/structured-exchange.md), which is
  for whoever writes a producer rather than for the agent.
- **`structured-exchange-project/`** — setting up the model and review rules a project
  holds those documents to: the registry, profiles and rules files, the loop through
  `present_project_model`, and the mistakes that validate yet check the wrong thing. Open it
  yourself with `/skill:structured-exchange-project`: models do not reliably open it alone. Pairs
  with [`docs/structured-exchange-project-setup.md`](../docs/structured-exchange-project-setup.md).
- **`drawio/`** — writing a draw.io diagram (`.drawio`) the user opens and edits in draw.io:
  the XML skeleton, shapes, connectors and containers that render everywhere, layout rules,
  and the loop through `drawio_check`, since the agent cannot see the rendering, ending with
  the diagram shown in the reply as a picture of the file, where the conversation draws it.
- **`posters/`** — making a poster, a worksheet or a slide as a `.poster.html` page the user
  opens in the file viewer's poster editor, retouches there and exports to Word or PowerPoint:
  the shared poster guide (the same words the Claude extension and the Open WebUI server give),
  the page skeleton with its three markers, and a complete example to start from.
- **`pptx-from-template/`** — building a PowerPoint deck from a `.potx`/`.pptx` template with
  `pptx_layouts`, `pptx_create` and `pptx_render`, and the render-and-fix loop that checks the
  slides are readable before the deck is handed over, and updating an existing deck slide by
  slide with `pptx_update`. Loading it (by name, or by the agent reading it) publishes the four
  tools.
- **`docx-from-template/`** — writing a Word document in a `.dotx`/`.docx` template's styles with
  `docx_styles`, `docx_create` and `docx_render`, and updating an existing document section by
  section, as tracked changes, with `docx_update`, and bringing an existing document into a
  template's styles with `docx_restyle`. Loading it publishes the five tools.
