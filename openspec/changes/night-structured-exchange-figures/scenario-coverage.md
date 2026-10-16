# Scenario coverage

OpenLore's automatic briefing pointed at the structured-exchange schema modules, not
at the drawing; targeted `rg` inspection found the figure palette in `shared/`, the
browser drawing in `ui/src/presentations/figureDrawing.tsx`, the live-tree export in
`StructuredExchangeView.tsx` and Mermaid's theme handling, which this change matches.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/night-structured-exchange-figures`.
The colour resolution happens in the browser (`light-dark()` against the page's
`color-scheme`), so the theme scenarios are checked in a real browser against the
seeded diagrams server; jsdom cannot resolve them.

| Scenario | Status | Test file and name |
|---|---|---|
| AFigureFollowsTheDarkTheme | covered | `e2e/structured-exchange-night.spec.ts`: `AFigureFollowsTheDarkTheme: the ground turns dark and the ink light, in graphs, sequences and timelines` — computed fill of the `#ffffff` ground below 0.02 luminance for a graph, a sequence and a timeline; every other declared colour painted differently from itself; a label's computed fill above 0.2 luminance; timeline frame background not white. Failed when run against the light theme. Also `e2e/openwebui-structures.spec.ts`: `AFigureFollowsTheDarkTheme in Open WebUI: the embed's figures and table key turn with the reader's preference` — the embed framed as Open WebUI frames it (srcdoc, no same-origin): graph and timeline ground `rgb(24, 24, 24)` in dark, `rgb(255, 255, 255)` in light, table key outlines distinct. |
| AFigureOnALightPageIsUnchanged | covered | `e2e/structured-exchange-night.spec.ts`: `AFigureOnALightPageIsUnchanged: every shape is painted the colour the figure carries` — computed fill equals the declared `#rrggbb` for every coloured shape of the three figures. |
| ADownloadedFigureKeepsItsDayColours | covered | `e2e/structured-exchange-night.spec.ts`: `ADownloadedFigureKeepsItsDayColours: a graph saved from a dark page is the light figure` — the downloaded graph and timeline files contain `fill="#ffffff"`, no `light-dark` and no `fill`/`stroke` style. |
| AKindKeepsItsHueAtNight | covered | `ui/src/presentations/nightPaint.test.ts`: `keeps a colour's hue, so a kind still matches its swatch` (hue shift under 15° for blue, orange, green, violet, red) and `keeps a pale fill dark and a strong stroke strong, in that order` (contrast against the night ground). The mapping is applied to every hex colour, declared or palette, in `figureDrawing.tsx`. |
| ATableKeyShowsItsRoleColours | covered | `e2e/structured-exchange-night.spec.ts`: `ATableKeyShowsItsRoleColours (light)` and `(dark)` — each swatch's border at least 2 px, its colour more than 80/255 from the page background and more than 40/255 from every other role's. Failed against the previous swatch markup. |
