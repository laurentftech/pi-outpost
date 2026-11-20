# Tasks

## 1. Build

- [x] 1.1 `toolInstallations` (Git, scoop shims, links, `.venv`'s `home`), guarded, in MXC's Windows request.
- [x] 1.2 `UV_CACHE_DIR` and `PIP_CACHE_DIR` in the private temporary directory.
- [x] 1.3 `sandbox.readOnlyPaths`: loaded, checked at each launch, kept by a diagnosis, carried over by Settings.
- [x] 1.4 `run_with_grant`'s description and the diagnosis note: a program's folder is a path to ask for.
- [x] 1.5 Documentation: `docs/sandboxing.md`, `docs/configuration.md`.

## 2. Verify on Windows 11 with MXC's process container

- [ ] 2.1 `uv run pytest` in a project whose `.venv` stands on a Python uv installed: runs.
- [ ] 2.2 `git status` with Git for Windows installed for the user (`AppData\Local\Programs\Git`): runs.
- [ ] 2.3 A scoop and a WinGet program found on `PATH`: run.
- [ ] 2.4 A diagnosis with `sandbox.readOnlyPaths` set: the configured directories are not reported as refused.
