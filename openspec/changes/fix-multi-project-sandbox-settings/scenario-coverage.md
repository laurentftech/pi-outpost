# Scenario coverage — fix-multi-project-sandbox-settings

Server scenarios are driven over a real server with two open projects, reading back the file browser's listing of
the project the connection is bound to — the root its tools are built on. Panel scenarios render the Settings menu
in jsdom and read back its controls and what Apply sends.

## Capability: `persistent-runtime-settings` (7 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ApplyFromASecondProjectKeepsItsDirectory | covered | `server/test/multiProjectSandboxSettings.test.mjs` — "applying Settings from a second project leaves it confined to its own directory" sends back the sandbox `hello` showed, from the second project, and asserts the listing still holds b.md and not a.md; it failed before the fix, listing the first project's files |
| APermissionChangedFromASecondProjectApplies | covered | `server/test/multiProjectSandboxSettings.test.mjs` — "changing a permission from a second project rebuilds it inside its own directory, with the new permission" asserts `rootEditable: false` and `projectRoot` on switching, then after allowing write with the first project's root: `allowWrite: true`, `projectRoot` the second project, `writableRoot` `""` (its whole directory), and a listing of b.md without a.md |
| WriteCanBeTurnedOffWhileAWritableRootIsKept | covered | `server/test/multiProjectSandboxSettings.test.mjs` — "write can be turned off and on again from a second project while the server keeps a writable root" asserts the first acknowledgement has `allowWrite: false`, the project `writableRoot` null and the server's writable root kept, and the second has the project writable again (`""`); found at the bench, where turning write off from a second project was refused by the configuration loader |
| TheServersProjectAloneStillMovesItsRoot | covered | `server/test/multiProjectSandboxSettings.test.mjs` — "the server's own project, open alone, still edits its root" asserts `rootEditable: true`, the acknowledged root is the subdirectory, and the listing is exactly c.md |
| ApplyIsOfferedOnlyAfterAChange | covered | `ui/src/components/SettingsMenu.test.tsx` — "offers no Apply until something in the section has changed, so an untouched sandbox is never rewritten" asserts Apply disabled and nothing sent on click, enabled after a toggle, disabled again when toggled back |
| SeveralProjectsShowPermissionsOnly | covered | `ui/src/components/SettingsMenu.test.tsx` — "with several projects open, shows the agent's permissions and this project's own folder, and no root to edit" asserts the "Agent permissions" title, the project's folder, no root or writable-root browse control, and that a permission change is sent |
| ASingleProjectKeepsTheFullSection | covered | `ui/src/components/SettingsMenu.test.tsx` — "keeps the roots editable when the server does not say otherwise" asserts the "Sandbox" title, the root browse control, and no project-folder line |
