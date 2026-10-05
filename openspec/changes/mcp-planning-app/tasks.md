# Tasks

## 1. The shared core

- [x] 1.1 Create `apps-core/` (`@pi-outpost/apps-core`, private) and move `planning.ts`,
  `operations.ts`, `guide.ts` and `structure.ts` there from `openwebui/src`. Add `descriptions.ts`,
  with the descriptions and examples taken out of `openapi.ts`, and `viewer.css`. Move the copying
  of the guide pages there.

  `openwebui/` imports them; its tests are not edited. Verify:
  - `npm test -w @pi-outpost/openwebui` passes unchanged;
  - `openwebui/test/image.sh` passes;
  - the Open WebUI e2e specs pass;
  - `npm run typecheck` and lint are clean.

## 2. The MCP server

- [x] 2.1 Create `mcp/` (`@pi-outpost/mcp`, private): the local store (layout and rules from
  `design.md`), configuration from `PLANNINGS_DIR`, and the tools wired to `apps-core`. Verify with
  `mcp/test/store.test.ts`, building expected paths with `path.join` and splitting on `/\r?\n/`:
  - `TheFolderIsCreatedWhenMissing`, `NoFolderNoStart`;
  - `APlanningIsOneReadableFile`, `HistoryIsKeptBesideAndHidden`;
  - `NothingIsWrittenOutsideTheFolder`;
  - `AFileEditedByHandIsJudgedOnRead`.
- [x] 2.2 Tools over MCP: list, create, get, update, show, read_structure_guide, and the app-only
  `select_in_planning`. Verify with `mcp/test/tools.test.ts`, which drives the server through the
  SDK's client:
  - `CreateThenListThenGet`, `AnInvalidTimelineIsRefusedWithTheGatesDiagnostics`,
    `AnUpdateIsTargetedAndRevisioned`;
  - `TheSelectionToolIsNotTheModels`, and a selection recorded, then returned by `get_planning`;
  - `TheViewNeedsNoNetwork` on the resource;
  - `BothServersDescribeTheToolsAlike`.

## 3. The view

- [x] 3.1 `mcp/viewer/`: the MCP Apps entry (`useApp`, `ontoolresult`, `onSelect` →
  `callServerTool` + `updateModelContext`, full screen, theme), with a single-file build. Verify in a
  Playwright spec whose host page uses the SDK's `AppBridge`, as `basic-host` does:
  - `TheViewDrawsTheShownPlanning`;
  - `AComparisonIsDrawn`;
  - `AClickedMilestoneIsReturnedByGetPlanning`: the host relays `tools/call` to the real server, then
    `get_planning` names the milestone;
  - `ClickingSendsNoMessage`: no `ui/message` is ever sent;
  - the reported size follows the content;
  - a dark host context keeps the timeline readable;
  - *Download SVG* goes through the host's `ui/download-file`, or else `save_figure` into the
    folder; *Copy SVG markup* works without the clipboard API.

- [ ] 3.2 The folder in the view: `list_plannings` declares the view and returns `{folder,
  plannings}`; the view draws the list, and choosing one draws its timeline through `show_planning`,
  with a way back. Verify in the AppBridge spec: `TheListShowsTheFolder`, `ChoosingAPlanningDrawsIt`.
  Then live in Claude Desktop: the list appears under the tool call.

## 4. The bundle

- [x] 4.1 `mcp/manifest.json` and `npm run pack -w @pi-outpost/mcp`, producing
  `dist/pi-outpost-plannings.mcpb`. Verify:
  - `TheBundleValidates` (`mcpb validate`, a required directory setting with no default);
  - `TheBundledServerAnswersOverStdio`: a script unpacks the bundle and drives it over stdio with a
    temporary folder.
- [x] 4.2 CI runs the pack and the stdio check. The release workflow attaches the `.mcpb` to the
  GitHub Release. Verify the workflows parse, and run the pack on a branch.

## 5. Live, documentation, coverage

- [ ] 5.1 Live in Claude Desktop with the user:
  - install from the `.mcpb` and pick the folder in the picker;
  - "crée un planning…" in French, then show it;
  - click a milestone, then "décale-le d'une semaine": record whether Claude found it through
    `get_planning`;
  - show the comparison;
  - check the folder holds one readable file and its hidden history.

  Then a breaking pass: a file edited by hand, a planning file deleted from the Finder, rapid updates,
  a title with `/` and `..`.
- [x] 5.2 Write `docs/claude-desktop.md` for the person installing it: download the `.mcpb`,
  double-click, choose the folder, what to ask, where the files are, how to remove it. Add a README
  entry. Verify the links.
- [x] 5.3 Write `scenario-coverage.md` with every scenario covered. Run `npm run check:scenarios` and
  `openspec validate mcp-planning-app --strict`.
