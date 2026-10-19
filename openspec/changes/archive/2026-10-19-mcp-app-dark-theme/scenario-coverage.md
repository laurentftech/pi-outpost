# Scenario coverage

OpenLore had no analysis index for this turn; targeted inspection of `mcp/viewer/main.tsx`
found the card forced light (`data-theme="light"`) while the page already read
`hostContext.theme`. The night colours themselves come from the archived change
`night-structured-exchange-figures`.

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/mcp-app-dark-theme`.
All are checked in `e2e/mcp-app.spec.ts`, which draws the built view in a sandboxed frame
behind the SDK's own `AppBridge` and the real server, colours read back from computed
styles. Claude Desktop itself is checked by hand (see the PR).

| Scenario | Status | Test file and name |
|---|---|---|
| AViewFollowsADarkHost | covered | `e2e/mcp-app.spec.ts`: `AViewFollowsADarkHost: the card and the timeline take the host's dark theme` — card background and the timeline's `#ffffff` ground computed under 60 on every channel, a task label above 200. |
| AViewFollowsALightHost | covered | `e2e/mcp-app.spec.ts`: `AViewFollowsALightHost: the card and the timeline stay light` — card and ground exactly white, label under 110. |
| AViewFollowsAThemeSwitchedLive | covered | `e2e/mcp-app.spec.ts`: `AViewFollowsAThemeSwitchedLive: the host changes theme while the planning is open` — `ui/notifications/host-context-changed` with `theme: "dark"` then `"light"`; the ground polls dark, then white. |
| AListFollowsADarkHost | covered | `e2e/mcp-app.spec.ts`: `AListFollowsADarkHost: the plannings list is readable on the host's dark theme` — list card under 60, a planning title above 200. |
| ADownloadFromADarkHostIsTheLightFigure | covered | `e2e/mcp-app.spec.ts`: `ADownloadFromADarkHostIsTheLightFigure: Download SVG keeps the day colours` — the file saved in the plannings folder contains `fill="#ffffff"` and no `light-dark`. |
