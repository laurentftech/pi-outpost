# The header keeps its controls on one row

## Why

On a bar too narrow for everything in it, each control sized itself from its text: the
browser shrank them and wrapped their labels, so "pi-outpost", "files", a branch name or
"+ new" went onto two lines and every box ended up a different height. What crowded the
bar most was the extensions' statuses — any extension may set any number, of any length.

## What Changes

- Every header control is one height (28 px) and never wraps; one shared style
  (`headerControl.ts`) instead of a copy per component.
- The labels the user does not choose — the project, the branch, the sandbox root, the
  title — give up width first, cut with an ellipsis, the full text on hover. The title
  gives way before the project and the branch, which keep a readable floor.
- The extensions' statuses stay inline while they fit; when one would be cut or the bar
  would overflow, they fold into "N statuses", which lists them in full. They unfold when
  the bar has grown well past where they folded, so a bar on the edge does not flicker.
- The embed's declaration build type-checks the sources under the same rules as `ui`
  (`strict`, `DOM.Iterable`), which silences eight spurious errors it printed on every build.

## Impact

`ui`: `Header.tsx`, `headerControl.ts`, and the triggers of `GitMenu`, `ProjectMenu`,
`TreeMenu`, `SettingsMenu`, `WorkspaceRootControl`; `embed/tsconfig.app.json`. No server
or protocol change.
