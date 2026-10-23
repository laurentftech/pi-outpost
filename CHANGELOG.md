# Changelog

What changed in each release of pi-outpost, newest first. This file ships inside the
package and the executables: after an update, the app shows the sections between the
version you had and the one you run now, without going online.

Releases before 0.41.0 are described on
[GitHub Releases](https://github.com/laurentftech/pi-outpost/releases).

## [0.49.0] - 2026-10-23

### Added

- **Coloured extension statuses.** Status badges keep the foreground colours, bold,
  dim, italic and underline styling sent by extensions, both in the header and in
  the overflow list. Hover titles remain plain text.
  ([#356](https://github.com/laurentftech/pi-outpost/pull/356))
- **Release notes readable by agents.** The npm package now carries `CHANGELOG.md`
  at its root, so agents and tools can read what changed without starting the server.
  ([#356](https://github.com/laurentftech/pi-outpost/pull/356))

### Changed

- **Pi SDK 1.4.0.** The npm CLI and server use the updated SDK.
  ([#356](https://github.com/laurentftech/pi-outpost/pull/356))

## [0.48.0] - 2026-10-23

### Added

- **Update the agent's pi packages from the terminal.** `pi-outpost update --extensions`
  installs the newest version of every npm pi package the agent loads, with the same rules
  as Settings: pinned packages stay put, a failed lookup is reported rather than called up to
  date, and `extensionLock` refuses. `pi-outpost update --all` updates pi-outpost, then the
  packages, and works from a standalone executable too. Plain `pi-outpost update` now ends
  by naming the packages that have a newer version.
  ([#351](https://github.com/laurentftech/pi-outpost/pull/351))
- **Choose the shell of each terminal.** A new terminal tab offers the shells installed on
  the machine, and defaults to PowerShell on Windows. The terminal's height can be resized
  and is remembered, the usual copy and paste shortcuts work, and its shell sessions come
  back after a reconnect. ([#355](https://github.com/laurentftech/pi-outpost/pull/355))
- **A System theme.** Next to Light and Dark, the header offers System, which follows your
  operating system. ([#355](https://github.com/laurentftech/pi-outpost/pull/355))
- **Git changes beside the scrollbar.** The file editor and the read-only source view mark
  every Git change next to the scrollbar; click a marker to jump to it, even when it is
  out of view. ([#355](https://github.com/laurentftech/pi-outpost/pull/355))
- **Credits.** Settings have a Credits page listing the third-party software pi-outpost
  includes, readable offline. ([#355](https://github.com/laurentftech/pi-outpost/pull/355))

### Changed

- **Opening a file no longer attaches it to your message.** Files you browse stay out of
  the composer; attach or pin one when you want the agent to see it.
  ([#355](https://github.com/laurentftech/pi-outpost/pull/355))
- **Restart the session at any time.** Settings always offer a session restart, to reload
  extensions and MCP servers without changing the configuration.
  ([#355](https://github.com/laurentftech/pi-outpost/pull/355))

### Fixed

- **Images and codemode in the standalone executable.** The agent saw no image (`read` on
  a picture answered "Image omitted") and codemode scripts failed to start; both now work in
  the executable as they do from npm.
  ([#353](https://github.com/laurentftech/pi-outpost/pull/353))
- **A Mermaid diagram drawn again no longer vanishes.** Turning a diagram back to an
  orientation it already had left the block with its buttons and no picture.
  ([#354](https://github.com/laurentftech/pi-outpost/pull/354))

## [0.47.0] - 2026-10-22

### Added

- **Tracked changes and comments in Word documents.** `docx_extract` with `review: true`
  marks every insertion, deletion and move where it sits, anchors each comment on its text,
  and closes with a list of them all — author, date, section, replies and whether the
  thread is resolved — so the agent can analyse the impact of a revision. The default
  reading now says when a document holds tracked changes or comments it does not show.
  ([#347](https://github.com/laurentftech/pi-outpost/pull/347))
- **Compare two versions of a Word document, on Windows.** When a document was revised
  without tracked changes, `docx_compare` has desktop Microsoft Word compare the two
  versions and returns every difference with the same markers, under its section; it can
  also save Word's compared document for you to open. Where Word is not available, the
  agent names the manual path: Review → Compare in Word.
  ([#348](https://github.com/laurentftech/pi-outpost/pull/348))

### Fixed

- **Word documents read as they now stand.** Moved text comes back once, at its
  destination; a table row deleted with tracking is no longer read as a row; and formatting
  replaced by a tracked change is no longer read as current.
  ([#347](https://github.com/laurentftech/pi-outpost/pull/347))
- **No Word left running after a timeout.** When rendering or comparing a Word document
  ran out of time, the Word it had started kept running, invisible; it is now ended.
  ([#348](https://github.com/laurentftech/pi-outpost/pull/348))

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
