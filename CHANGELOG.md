# Changelog

What changed in each release of pi-outpost, newest first. This file ships inside the
package and the executables: after an update, the app shows the sections between the
version you had and the one you run now, without going online.

Releases before 0.41.0 are described on
[GitHub Releases](https://github.com/laurentftech/pi-outpost/releases).

## [0.46.0] - 2026-10-20

### Added

- **Draw.io diagrams in replies.** Diagrams included in agent replies are interactive, and
  you can ask the agent to adjust one in place. ([#345](https://github.com/laurentftech/pi-outpost/pull/345))

## [0.45.0] - 2026-10-20

### Added

- **draw.io diagrams, seen and made.** A `.drawio` file opens drawn in the file viewer, by
  draw.io's own viewer — every page, zoom, dark mode — with nothing fetched from anywhere;
  "open in draw.io" hands it to draw.io desktop for editing, and the view follows the saved
  file. The agent writes draw.io diagrams and checks them with `drawio_check`.

## [0.44.0] - 2026-10-20

### Added

- **The commit history is a metro map.** The branch chip's menu draws the checked-out
  line and every local branch as parallel coloured lines, with merges as curves, branch
  names at their tips and tags on their commits. The checked-out line always runs first,
  in green. A commit or a branch made in a terminal shows up while the menu is open.
  ([#341](https://github.com/laurentftech/pi-outpost/pull/341))
- **What's changed, after an update.** This changelog now ships inside pi-outpost: once
  updated, the app names the version you came from and shows what changed since, without
  going online. The notice of a newer version links its release notes.
  ([#342](https://github.com/laurentftech/pi-outpost/pull/342))

## [0.43.0] - 2026-10-20

### Added

- **A change gutter in the editor**: a bar beside each line added or changed since HEAD,
  a notch where lines were removed. A click shows what was there and, while editing,
  reverts that change into the draft. The git state now follows commits, checkouts and
  resets made outside the app. ([#338](https://github.com/laurentftech/pi-outpost/pull/338))

### Fixed

- A confined shell's history is kept out of the project.
  ([#340](https://github.com/laurentftech/pi-outpost/pull/340))
- The header's controls stay on one row. ([#339](https://github.com/laurentftech/pi-outpost/pull/339))
- `show_planning` repeats its summary in its structured content.
  ([#336](https://github.com/laurentftech/pi-outpost/pull/336))

## [0.42.0] - 2026-10-19

### Added

- **Provider accounts**: sign in to model providers and manage the accounts from the app.
  ([#335](https://github.com/laurentftech/pi-outpost/pull/335))
- **A lock that shows confinement was verified**, not only configured.
  ([#334](https://github.com/laurentftech/pi-outpost/pull/334))
- **More sandbox runners**: Seatbelt through `sandbox-exec` on every Mac
  ([#330](https://github.com/laurentftech/pi-outpost/pull/330)), and MXC's macOS
  ([#329](https://github.com/laurentftech/pi-outpost/pull/329)) and Linux
  ([#328](https://github.com/laurentftech/pi-outpost/pull/328)) executors.
- **`sandbox.allowedHosts`**: under MXC, the agent's shell reaches only the hosts you name.
  ([#327](https://github.com/laurentftech/pi-outpost/pull/327))

### Fixed

- A confined shell reads the global git ignore and attributes files.
  ([#332](https://github.com/laurentftech/pi-outpost/pull/332))
- MXC is asked for no clipboard and no input injection.
  ([#326](https://github.com/laurentftech/pi-outpost/pull/326))

## [0.41.0] - 2026-10-18

### Changed

- The Claude Desktop planning view follows the host's theme.
  ([#323](https://github.com/laurentftech/pi-outpost/pull/323))
- Structured-exchange figures follow the dark theme, and the table key names its colours.
  ([#322](https://github.com/laurentftech/pi-outpost/pull/322))
- `@microsoft/mxc-sdk` 1.0.1. ([#324](https://github.com/laurentftech/pi-outpost/pull/324))

### Fixed

- A confined shell runs a turn's commands in order.
  ([#325](https://github.com/laurentftech/pi-outpost/pull/325))
