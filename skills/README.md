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
- **`pptx-from-template/`** — building a PowerPoint deck from a `.potx`/`.pptx` template with
  `pptx_layouts`, `pptx_create` and `pptx_render`, and the render-and-fix loop that checks the
  slides are readable before the deck is handed over. Loading it (by name, or by the agent
  reading it) publishes the three tools.
