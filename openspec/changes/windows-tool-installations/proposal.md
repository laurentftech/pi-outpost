# Proposal

## Why

Under MXC on Windows, a confined command can read every folder its `PATH` names — but only that
folder. Many tools installed for the user put a launcher there and the program elsewhere, so the
launcher is refused when it starts the program: Git for Windows installed per user (`Git\cmd\git.exe`
starts `Git\mingw64\bin\git.exe`), scoop's shims, WinGet's `Links`, nvm-windows' linked folder. A
virtual environment's `python.exe` (uv's, venv's) loads the interpreter its `pyvenv.cfg` names, under
the user's profile for a Python uv installed: `uv run pytest` fails with "Failed to query Python
interpreter … Access denied (os error 5)". uv's and pip's caches are in the profile too, refused.

The agent could ask for those folders with `run_with_grant`, but its description said "no grant lets a
command start a program outside the sandbox", which a model read as "a program installed outside the
project cannot be granted", and it did not ask. And a rule is the project's: a tool installed for the
user had to be granted again in every project.

## What Changes

- Under MXC on Windows, each `PATH` folder that only holds launchers has the installation they start made
  readable, read only, followed one step: Git's layout, the program a scoop `.shim` names, a link's target.
  The project's `.venv` has the interpreter its `pyvenv.cfg` names readable, when that folder is a Python
  installation (`python.exe` and `Lib`): the agent writes `pyvenv.cfg`, and cannot name another folder.
  Every folder taken passes the search path's guard. The terminal panel's request is built the same way.
- uv's and pip's caches go to the command's private temporary directory (`UV_CACHE_DIR`, `PIP_CACHE_DIR`),
  as npm's already does — never the user's own cache made writable.
- `sandbox.readOnlyPaths`: directories every command of the agent's confined shell may read, in every
  project, read only, checked at each launch as a grant is. Kept by a diagnosis; carried over by Settings.
- `run_with_grant`'s description, and the note offering a diagnosis, say that "access denied" starting a
  program is a refused path: its folder is asked for, read only. What no grant allows is leaving the
  sandbox — a desktop application, the browser.

## Capabilities

### Modified Capabilities
- `sandbox-runner-bash`: the search path's installations under MXC on Windows, private tool caches,
  and `sandbox.readOnlyPaths`.
