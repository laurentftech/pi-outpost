# Design: the way down on another drive is readable, as the root's drive is

## Measured (issue #572, reproduced on Windows 11 26100, MXC tier 1)

- Project root on `C:`, scoop tree on a second drive letter (`D:` via `subst`, and the reporter's
  `D:\WRK\Scoop` partition): `Get-Command node` fails, `node -v` fails, `Test-Path <junction>\node.exe`
  refused — at enumeration levels 0, 1 and 2 alike. With an explicit read grant on the tool's folder,
  resolution works. Same layout entirely on `C:` works at every level.
- The root's drive is in `readonlyPaths` whole, so every folder on it is traversable. On another drive
  only the tool folders themselves were allowed; their ancestors were at best *enumerated* (names only),
  and the drive root was not allowed at all — MXC refuses to traverse it, so nothing on that drive
  opened, by name or by full path.

## Mechanism

- `ancestorsToEnumerate` now includes the **root of a foreign drive** in its output (the root's own
  drive root is already readable, so it is excluded there).
- `mxcTerminalConfig` then moves every path on a foreign drive — that drive's root and the enumerated
  ancestors of the tools on it — from `enumeratePaths` to `readonlyPaths`. Readable shows a folder's
  names, as enumeration would; files directly beside the way down are not in any allow, and folders
  beside the way keep their contents denied.
- The junction handling from #562 is unchanged: a link on the way down is never enumerated, its target
  is readable, wherever the executable sits in the target — its root included.

## Security

- Exposure added: the names of the folders on the way down on the foreign drive (and any file sitting
  directly in one of those folders) — the same exposure the root's drive already has. No folder's
  *contents* open up: each still needs its own allow.
- The agent directory and the configuration stay denied wherever they are, including on a foreign
  drive (`covered`/`secrets` guards run before anything is pushed).

## Known limits, kept

- A foreign drive's root becomes readable: its top-level names are listable. That matches the root's
  drive, which is readable whole for git's working-directory lookup (microsoft/mxc#1464).
