## 1. Server

- [x] 1.1 Rebuild a project after Settings apply with `sandboxFor(project)`, and take only permissions from a project that does not own the roots; verify `server/test/multiProjectSandboxSettings.test.mjs` for `ApplyFromASecondProjectKeepsItsDirectory`, `APermissionChangedFromASecondProjectApplies`, `TheServersProjectAloneStillMovesItsRoot` (the first failed before the fix)
- [x] 1.3 Keep, and ignore, a writable root while write is off instead of refusing the configuration; verify `WriteCanBeTurnedOffWhileAWritableRootIsKept` in the same test file (found at the bench)
- [x] 1.2 Skip persisting and reapplying an unchanged sandbox, acknowledging an otherwise empty update without replacing the session; verify the first test above, which sends the shown sandbox back unchanged

## 2. Settings panel

- [x] 2.1 Report `sandbox.projectRoot` and `sandbox.rootEditable` in the snapshot; show "Agent permissions" with the project's folder and no root controls when not editable; offer Apply only after a change; verify `ui/src/components/SettingsMenu.test.tsx` for `ApplyIsOfferedOnlyAfterAChange`, `SeveralProjectsShowPermissionsOnly`, `ASingleProjectKeepsTheFullSection`

## 3. Verification

- [x] 3.1 Scenario coverage, `npm run check:scenarios`, full suites, typecheck, lint, `openspec validate --strict`
- [x] 3.2 Bench: Settings on the projects server — permissions section on each project, a permission change applied from the second project, then the file tree of both
