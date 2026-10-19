# A git gutter in the file editor

## Why

The only way to see what changed in a file since HEAD is the "± diff" toggle, which
replaces the file with a side-by-side diff. Reading or editing the file and seeing what
changed in it are two screens. VS Code puts both on one: a bar beside each changed line,
a click to see what was there, and a revert of that one change.

## What Changes

- The file's source view and its editor draw a gutter between the line numbers and the
  fold markers: a bar beside lines added (green) or changed (blue) since HEAD, a notch
  where lines were removed (red).
- It compares HEAD with what the editor holds, so it follows the draft as it is typed.
- A click on a mark opens HEAD's text under the change; in the editor, "Revert this
  change" puts it back into the draft. Nothing is saved without the user.
- Drawn for a file whose status is modified, added or conflicted; not for an untracked
  or clean file, nor for one HEAD cannot be compared with (binary, over the size limit).
- The git state follows changes made outside the application. A commit, checkout or
  reset only touches the git directory, which nobody lists, so the status was not re-read:
  the tree's badges, the branch chip and the gutter went on describing a HEAD that had
  moved — after a checkout, the gutter silently compared with another branch. The server
  now watches each repository's git directory and tells clients which repository moved.
- The UI suite's function coverage sat on its 93% threshold and failed CI on timing alone
  (`310bacb`); the margin is won back here.

## Impact

- `ui`: a new CodeMirror extension (`gitGutter.ts`), the editor's `baseline`, a
  `gitBaseline` slot in `useAgent`; styles in `web/src/index.css`.
- New dependency `@codemirror/merge` (MIT, by CodeMirror's author), for its Myers diff
  only.
- The gutter asks the existing `git_diff` with requests of its own, told apart from the
  diff pane's.
- `server`: a watcher per repository's git directory (`gitMetadataWatcher.ts`), owned by
  the workspace; `gitDirOf` in `git.ts`. Protocol: a `git_changed { repo }` message.
