# A shown poster follows its file

## Why
In pi-outpost, a poster open in the viewer keeps showing the version it opened with: the agent
rewrites the file, the viewer reads the new source, and the editor never receives it. Only
closing and reopening the file shows the change, so the person is told the agent did something
they cannot see. The save guard has a second gap: it takes the file's time when the editor
frame opens, not the time of the content it shows, so a write landing in between would be
overwritten by the next save instead of refusing it.

## What Changes
- An editor holding no unsaved touch-ups shows the file's new version when the file changes.
- An editor holding unsaved touch-ups keeps them; saving stays refused, and once it holds none
  (it says it is clean, or they are discarded) the editor shows the file as it is now.
- The person's own save does not reopen the editor.
- A save is checked against the time of the version the editor shows.

## Impact
`ui/src/components/PosterFrame.tsx`, `ui/src/components/FileViewer.tsx`. No change to the editor
frame, the protocol between them, or the other hosts (Claude Desktop, Open WebUI).
