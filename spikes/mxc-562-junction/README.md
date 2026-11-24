# MXC #562 junction e2e probe

One-off probe for [issue #562](https://github.com/laurentftech/pi-outpost/issues/562): under a real
MXC tier 1 process container, does a tool behind a scoop-style `current` junction (a link on the way
down to the tool) resolve on `PATH`?

`probe.mjs` lays out `C:\pi562` like the reporter's machine (project root, denied sibling holding a
scoop tree, `apps\nodejs\current` a junction to the versioned folder), builds the policy with the
branch's own `mxcTerminalConfig`, launches PowerShell through the SDK in process exactly as the
agent's shell does (stepping the enumeration down on a `CreateProcessSecurityEnvironment` refusal),
and records what `Get-Command node`, `node -v`, `realpathSync` and a listing of a denied folder see.

Run by `.github/workflows/mxc-562-junction.yml` on `windows-11-arm` (tier 1 per spike #558) and
`windows-latest` (control), triggered by pushing this branch. Results are written incrementally to
`results/<label>/` (spot runners get preempted) and uploaded as artifacts.

This probe is not part of the fix; it exists to measure the fix on a real tier 1 host and is removed
from the branch once it has run.
