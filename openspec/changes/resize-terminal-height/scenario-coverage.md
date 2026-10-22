# Scenario coverage

OpenLore orient ran before source inspection. Graph unavailable: CLI orient and targeted rg provided ownership/insertion evidence. Requested intent (vertical dragging), current spec (no height control) and implementation (fixed h-72 plus existing horizontal reusable handle) reconciled in `design.md`.

Inventory verified with rg '^#### Scenario:' openspec/ and scoped main/delta specs. Applicable requirements are terminal height and the two shared resize components; unrelated terminal runner requirements retain the inventory in `openspec/changes/choose-terminal-shell/scenario-coverage.md` and are not completion requirements here.

| Scenario | Status | Test file and test name | Contract assertions |
| --- | --- | --- | --- |
| ResizeTerminalHeight | covered | `ui/src/components/TerminalPanel.test.tsx`: ResizeTerminalHeight; `scripts/probes/terminal-height.mjs` | Upward drag adds 100px, no new terminal_open, actual PTY rows grow from 14 to 19 and PowerShell reports 19. |
| TerminalHeightBoundsAndCancel | covered | `TerminalPanel.test.tsx`: TerminalHeightBoundsAndCancel; `terminal-height.mjs` | Extreme drags clamp at preference 640 and actual minimum 160, viewport cap holds; pointercancel restores 288 without replacing stored value; Up/Down/Home and ARIA checked. |
| RestoreTerminalHeight | covered | `TerminalPanel.test.tsx`: ResizeTerminalHeight; `terminal-height.mjs` | 388px preference survives remount, maximize/restore, minimize/open and a real page reload. |
| Resize with pointer input | covered | `ui/src/components/Sidebar.test.tsx`: Resize with pointer input: follows the horizontal pointer and commits only when the drag ends | Exact sidebar width and storage commit boundary remain asserted. |
| Enforce resizing bounds | covered | `Sidebar.test.tsx`: Enforce resizing bounds: clamps pointer movement at both boundaries | Exact 224/640 bounds. |
| Resize with the keyboard | covered | `Sidebar.test.tsx`: Resize with the keyboard: changes by one step, resets with Home, and updates ARIA | Left/Right steps and Home retain horizontal behavior. |
| Restore the preferred width | covered | `Sidebar.test.tsx`: Restore the preferred width: restores a completed resize after remounting | Browser preference restored on remount. |
| Recover from an invalid stored preference | covered | `Sidebar.test.tsx`: Recover from an invalid stored preference: defaults malformed values and clamps finite ones; `ui/src/util/panelWidth.test.ts` | Invalid/nonfinite preferences default, valid numbers clamp. |
| Resize the History commit list | covered | `ui/src/components/GitFileHistory.test.tsx`: Resize the History commit list | Existing horizontal split pointer/keyboard and bounds assertions pass. |
| Restore independent panel widths | covered | `ui/src/components/GitFileHistory.test.tsx`: Restore independent panel widths: restores History without changing the Files preference | Independent storage keys and restored sizes asserted. |
| Preserve the stacked History layout | covered | `GitFileHistory.test.tsx`: Preserve the stacked History layout: keeps full-width responsive sizing and hides the desktop separator | Responsive stacked sizing and hidden handle remain asserted. |
| Header button and keyboard shortcut toggle | covered | `TerminalPanel.test.tsx`: is hidden with CSS class when minimized without unmounting; `terminal-height.mjs` | Hide/open preserves panel height and existing shell. |
| Multi-tab management and inline renaming | covered | `TerminalPanel.test.tsx`: adds a new tab when clicking + button; allows renaming tabs on double click; existing focus regression | Existing tab creation/rename assertions pass unchanged. |

## Validation

- 70 focused tests passed: TerminalPanel, Sidebar, GitFileHistory, panelWidth. Assertions reviewed.
- Embed TypeScript/build passed.
- Real Playwright widget: dragging, PTY dimension roundtrip, minimize/restore, maximize/restore, extreme moves, pointercancel, keyboard and reload all passed with no page errors.
- Strict OpenSpec validation and git diff --check passed.

## Documentation impact

`README.md` describes top-border dragging, local height preference and keyboard controls.
