# A failing commit history stays in its menu

## Why
A red `git: git log failed` appears at the bottom of the conversation while the person does nothing.
Opening the branch chip's history once leaves the client asking for that history again on every
change git makes to the repository's own directory, menu closed or not; an editor that refreshes
the index or fetches in the background is enough. When that request fails, its error belongs to no
pane and lands in the conversation's error banner. And the text says nothing: git was killed by the
10-second timeout, or never started, and wrote nothing, so the server falls back to `git log failed`.

## What Changes
- The commit map is asked for again only while it is open; closing it forgets it, and reopening asks afresh.
- A failure of the commit map is shown inside the map, never in the conversation's error banner.
- A git command that fails without a word from git says why: the time limit it ran out of, git not
  found, or more output than the server reads.

## Impact
`ui/src/useAgent.ts`, `ui/src/components/GitMenu.tsx`, `ui/src/components/Header.tsx`, `ui/src/App.tsx`,
`server/src/git.ts`. No protocol change: `git_error` already carries the request id the client needs.
