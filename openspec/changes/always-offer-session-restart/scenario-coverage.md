# Scenario coverage

OpenLore orient ran first; its graph was unavailable. CLI orient, rg and assertion review supplied implementation evidence. Relevant main/delta scenarios enumerated with rg '^#### Scenario:' openspec/ (full local inventory retained). Intent and implementation discrepancy (unchanged Apply is a no-op; session creation caches extensions) reconciled in `design.md`. The existing AnUnchangedSandboxIsNotAChange remains unchanged: the manual command is explicit, carries no sandbox and is separate from update_config.

| Scenario | Status | Test file / test name | Assertions |
| --- | --- | --- | --- |
| RestartWithoutChanges | covered | `server/test/restartSession.test.mjs`: RestartWithoutChanges; `ui/src/components/SettingsMenu.test.tsx`: RestartWithoutChanges | Edited extension v2 replaces v1 in actual runtime tools; session ID changes; config byte-identical. UI invokes restart callback without onUpdateConfig. Real widget confirms new tool after opening inventory. |
| RestartWithoutSandbox | covered | `SettingsMenu.test.tsx`: RestartWithoutSandbox; `restartSession.test.mjs`: RestartWithoutChanges | Button available with sandbox null; real server and widget with sandbox absent create a fresh session. |
| RestartMcp | covered | `restartSession.test.mjs`: RestartMcp | Real MCP JSON-RPC stdio initializes v1; editing mcp.json then restart initializes v2 from the new config. |
| RestartVeto | covered | `restartSession.test.mjs`: RestartVeto; actual Playwright widget run (temporary local harness) | Server returns veto and a fresh client sees unchanged session ID. Real widget retains visible alert, same session, enabled retry control. |
| RestartInProgress | covered | `restartSession.test.mjs`: RestartWithoutChanges concurrent-frame assertions; `SettingsMenu.test.tsx`: stays open while the apply is in flight, and closes once it is acknowledged | Two simultaneous requests yield one refusal and one newly correlated session acknowledgement. UI applying state disables the button until acknowledgement. |
| ApplyIsOfferedOnlyAfterAChange | covered | `SettingsMenu.test.tsx`: RestartWithoutChanges | Apply appears only after changing a field and is replaced by manual Restart after reverting. No unchanged sandbox is sent. |
| SeveralProjectsShowPermissionsOnly | covered | `SettingsMenu.test.tsx`: with several projects open, shows the agent's permissions and this project's own folder, and no root to edit | Existing permission/root assertions still pass. |
| ASingleProjectKeepsTheFullSection | covered | `SettingsMenu.test.tsx`: the sandbox form and locked fields tests | Existing root fields/browse and lock assertions pass. |

Other main persistent-runtime-settings scenarios concern unchanged persistence, path enrollment, collections and multi-project application paths; no new full-platform claim is made for those requirements. Manual restart neither enters their persistence branch nor mutates global config.

## Executed verification

- 267 focused UI tests pass (SettingsMenu and useAgent).
- Three real-server tests pass for changed extension code, MCP and veto; concurrency included.
- Embed production build and server TypeScript check pass.
- Actual Playwright widget: explicit click without sandbox or edited settings, new runtime tool visible, config byte-identical, no page errors. Failure pass: real extension veto remains visible without changing session.
- Strict OpenSpec validation and diff whitespace check pass.

## Documentation impact

`README.md` Settings section documents fresh conversation, resource reload, unchanged configuration and unsupported-runtime behavior.
