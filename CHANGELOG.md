# Changelog

What changed in each release of pi-outpost, newest first. This file ships inside the
package and the executables: after an update, the app shows the sections between the
version you had and the one you run now, without going online.

Releases before 0.41.0 are described on
[GitHub Releases](https://github.com/laurentftech/pi-outpost/releases).

## [0.62.2] - 2026-11-11

### Fixed

- **Decode Outlook rich-text email without duplicating Unicode fallback characters.**
  ([#480](https://github.com/laurentftech/pi-outpost/pull/480))
- **Keep email text when multipart boundaries are missing and preserve loosely written
  HTML tables.** ([#481](https://github.com/laurentftech/pi-outpost/pull/481),
  [#483](https://github.com/laurentftech/pi-outpost/pull/483))
- **Stop the agent turn even when queued messages cannot be kept pending.**
  ([#484](https://github.com/laurentftech/pi-outpost/pull/484))
- **Close Windows pseudo-terminals when their shell exits.**
  ([#481](https://github.com/laurentftech/pi-outpost/pull/481))

## [0.62.1] - 2026-11-10

### Fixed

- **Thinking controls respect the model's minimum.** Models requiring reasoning no
  longer offer an unsupported `off` choice; models allowing it keep that choice.
  ([#478](https://github.com/laurentftech/pi-outpost/pull/478))
- **Find on-demand tools again after they leave the prompt.** `tool_search` can reload
  the extended Work Plan tools after inactivity. In embedded sessions, calling a
  remembered deferred tool from another extension also reactivates it.
  ([#474](https://github.com/laurentftech/pi-outpost/pull/474))

### Changed

- **Updated the pi engine to 1.5.1**, with tool-search, file-reading and grep fixes.
  When no model is configured, the Anthropic default is now Claude Opus 5.5.
  Eligible prompt caches can now be warmed while idle, which can incur provider
  charges; set `cacheWarming` to `"streaming"` for the previous behavior or `"off"`
  in `<agentDir>/settings.json` to disable warming.
  ([#478](https://github.com/laurentftech/pi-outpost/pull/478))
- More automated checks exercise malformed ZIP archives, email and structured-exchange
  documents. ([#472](https://github.com/laurentftech/pi-outpost/pull/472))
- Refreshed the project website, with clearer guidance on built-in sandboxing and
  deployment options. ([#475](https://github.com/laurentftech/pi-outpost/pull/475),
  [#476](https://github.com/laurentftech/pi-outpost/pull/476))

## [0.62.0] - 2026-11-08

### Added

- **Host questions under landstrip on Linux.** `sandbox.allowedHosts` now works with
  landstrip: the agent's shell reaches the listed hosts through the server's proxy, and a
  connection to any other host asks you, as under MXC and Seatbelt. An empty list asks about
  every host. ([#468](https://github.com/laurentftech/pi-outpost/pull/468))

### Changed

- **Docker: the agent's network asks you by default.** The image used to close the agent's
  network unless the operator opted in; it now reaches hosts only through the server's proxy,
  which asks you about each one. Existing volumes get `sandbox.allowedHosts: []` at startup.
  `ALLOW_AGENT_NETWORK=0` now refuses all networking, the proxy included, and `1` follows
  your configuration as before. The image ships landstrip 0.20.26, which also hides the
  server's processes from the agent's commands. ([#468](https://github.com/laurentftech/pi-outpost/pull/468))
- **Remote servers require encrypted transport.** A server listening beyond the loopback
  now refuses plain HTTP: configure a certificate for native HTTPS/WSS, or keep it on the
  loopback behind SSH or a TLS proxy. `server.allowInsecureHttp` (or
  `PI_OUTPOST_ALLOW_INSECURE_HTTP=1`) keeps plain HTTP for a hop you protect otherwise, with
  a warning. Loopback HTTP is unchanged. ([#463](https://github.com/laurentftech/pi-outpost/pull/463))

### Fixed

- Under landstrip, a refused operation is told to the agent in words instead of landstrip's
  JSON report, so a command that survived the refusal is no longer taken for a failed one;
  the startup line now says an empty host list asks about every host.
  ([#469](https://github.com/laurentftech/pi-outpost/pull/469))
- draw.io wires with a fixed end on a shape that has perimeter spacing end where draw.io
  draws them, and `drawio_check` judges those routes as drawn.
  ([#467](https://github.com/laurentftech/pi-outpost/pull/467))

## [0.61.0] - 2026-11-08

### Added

- **One actions menu per row in the Files tree.** Each file and folder now has a single
  `⋯` menu (also on right-click) instead of a row of unlabelled icons. Folders can be
  renamed, moved, deleted and downloaded like files. Select several entries with
  Shift-click or Ctrl/Cmd-click to delete, move, download or reference them together.
  **Download** saves a file as itself, and a folder or a selection as one `.zip`.
  The last move, rename or deletion can be undone (Undo, or Ctrl/Cmd+Z): deleted entries
  go to a temporary server trash, emptied at startup and after 24 hours.
  ([#438](https://github.com/laurentftech/pi-outpost/pull/438))
- **Git credentials for private repositories in Agent resources.** When a clone or refresh
  needs a login, the panel asks for a user name and token, stores them for that host and
  retries. Settings → Accounts lists the stored Git hosts and removes them. Git errors now
  show git's actual reason instead of its progress line. ([#428](https://github.com/laurentftech/pi-outpost/pull/428))
- **Host questions on Linux and macOS sandboxes.** Under MXC on Linux and macOS and under
  Seatbelt, a connection to a host missing from `sandbox.allowedHosts` now asks you
  instead of being refused silently. ([#429](https://github.com/laurentftech/pi-outpost/pull/429))
- Release files now carry signed build provenance: check a download with
  `gh attestation verify <file> -R laurentftech/pi-outpost`. ([#436](https://github.com/laurentftech/pi-outpost/pull/436))

### Fixed

- Terminal colours in tool output are rendered instead of printed as escape codes, in the
  app and in the HTML export. ([#427](https://github.com/laurentftech/pi-outpost/pull/427))
- A session whose first reply starts with a tool call is titled from its answer, not from
  the question alone. ([#449](https://github.com/laurentftech/pi-outpost/pull/449))

## [0.60.1] - 2026-11-06

### Fixed

- Hardened filesystem access, document parsing, command execution, URL validation and
  diagnostic logging against untrusted input. ([#420](https://github.com/laurentftech/pi-outpost/pull/420),
  [#422](https://github.com/laurentftech/pi-outpost/pull/422))

## [0.60.0] - 2026-11-05

### Added

- **Run the full app with Python in Docker.** A Compose recipe includes the web
  interface, agent, Python/venv and integrated terminal, with persistent projects
  and agent settings. The app runs as a non-root user and verifies shell and terminal
  confinement before serving. Agent shell networking is off by default and can be
  enabled explicitly by the operator. Releases now publish the tested Linux x64 image
  to `ghcr.io/laurentftech/pi-outpost`, with a version tag and `latest` for stable releases.
  The deployment guide documents the required sandbox profiles and host prerequisites.
  ([#416](https://github.com/laurentftech/pi-outpost/pull/416))

### Changed

- **Clearer contribution and security guidance.** The repository now documents
  contribution requirements, private vulnerability reporting, quality checks and
  their limitations. Bug and feature issue forms help provide useful reports.
  Server lint and broader JavaScript/TypeScript CodeQL analysis extend the existing
  checks; the analysis also reports existing findings that need triage.
  ([#418](https://github.com/laurentftech/pi-outpost/pull/418))
- **Updated dependency maintenance.** Bump glob and related locked dependencies.
  ([#415](https://github.com/laurentftech/pi-outpost/pull/415))

### Fixed

- **Keep stable extension symlinks across updates.** Adding an extension folder
  preserves the chosen symlink or Windows junction instead of saving its versioned
  target. The resource manager displays the configured folder and removes the correct
  entry without deleting its files. After repointing the link, restart pi-outpost to
  load the new extension code.
  ([#417](https://github.com/laurentftech/pi-outpost/pull/417))

## [0.59.1] - 2026-11-05

### Changed

- **Keep the conversation visible while answering questions.** Questions now appear
  below the timeline, leaving the context readable and scrollable. Short choices use
  up to two columns when there is room; long descriptions and narrow windows keep
  one column. Sandbox permission requests scroll their command, paths and explanation
  independently, with all three decision buttons kept visible.
  ([#412](https://github.com/laurentftech/pi-outpost/pull/412),
  [#413](https://github.com/laurentftech/pi-outpost/pull/413))
- **Install safely with npm 12.** Installation instructions and the updater explicitly
  allow the native scripts needed by the terminal and sandbox while blocking unrelated
  dependency scripts. Use `npx --allow-scripts=node-pty,koffi pi-outpost` with npm 12
  and a compatible Node version (24.15+ or 26+).
  ([#411](https://github.com/laurentftech/pi-outpost/pull/411))

### Fixed

- **Unanswered questions survive browser disconnections.** A connection lost during
  browser sleep no longer becomes a refusal sent to the agent. Questions without an
  extension-defined deadline reappear on reconnect, and a project waiting for your
  answer stays available even after its idle timeout. Starting a new session can
  still deliberately abandon an old question.
  ([#414](https://github.com/laurentftech/pi-outpost/pull/414))

## [0.59.0] - 2026-11-04

### Changed

- **Keep the conversation visible in narrow windows.** The Work Plan collapses
  automatically below 768 pixels and restores its desktop state when the window
  widens. The model selector and Settings resources also have clearer accessible
  names and improved contrast.
  ([#407](https://github.com/laurentftech/pi-outpost/pull/407))
- **Updated diagram and page editors.** Mermaid is now 12.3.0 and GrapesJS 0.23.9.
  ([#407](https://github.com/laurentftech/pi-outpost/pull/407))

### Fixed

- **Send queued messages immediately after an interruption.** “Send now” starts a
  new turn with the pending messages, including when the agent was running a tool.
  Stopping the agent keeps pending messages ready for the next prompt. Long
  conversations no longer create a second page scrollbar.
  ([#405](https://github.com/laurentftech/pi-outpost/pull/405))
- **Reuse document tools after reopening a session.** Tools discovered for PDFs,
  Word documents, presentations and spreadsheets are restored when the session
  resumes. Repeating an earlier tool call works without another discovery step.
  ([#406](https://github.com/laurentftech/pi-outpost/pull/406))
- **HTTPS commands work in the macOS sandbox.** The sandbox now permits the
  system certificate trust service needed to validate HTTPS connections.
  ([#405](https://github.com/laurentftech/pi-outpost/pull/405))

## [0.58.0] - 2026-11-03

### Added

- **Add and remove pi packages from Settings.** Under Extensions → Packages,
  **Add a package** takes an npm name (`openlore`, `@scope/name`, or
  `name@1.2.3` to pin that version) and installs it for all projects or for
  this project only. The name is looked up on the registry your npm
  configuration uses first, and the confirmation names the version that will
  be installed. **Remove** uninstalls a package; it keeps running until
  pi-outpost restarts, so it stays listed with **Undo** until then. Nothing
  changes while an agent is working, and `extensionLock` forbids both.
  ([#404](https://github.com/laurentftech/pi-outpost/pull/404))

### Changed

- **Queued messages are lighter.** A message waiting for the agent now looks
  like a sent one, only paler, without a frame or a heading; a single line under
  the queue says "queued", with "send now" as a plain link. When the queue
  cannot be sent (a message an extension queued, or the connection dropped), the
  line still says "queued", without the link.
  ([#403](https://github.com/laurentftech/pi-outpost/pull/403))
- **The restart notice names each package once, by its latest change.** It now
  covers packages added and removed, and drops one put back as it was.
  ([#404](https://github.com/laurentftech/pi-outpost/pull/404))

## [0.57.0] - 2026-11-02

### Added

- **Change a message the agent has not read yet.** A message you send while the
  agent works waits until the end of its current step. It now shows below the
  running turn, marked as queued, with the usual ✎ to rewrite it and a ✕ to
  take it out; once the agent reads it, it joins the conversation where it was
  read. If the agent reads it while you are editing it, your edit lands in the
  composer instead of being lost.
  ([#400](https://github.com/laurentftech/pi-outpost/pull/400))
- **Send queued messages now.** One button sends everything that is queued at
  once. After a stop, it sends them without your typing a new message. While
  the agent works, it first stops the current step, and tells you so before
  doing it: a reply being written is dropped and a running tool is stopped,
  while the work already done is kept.
  ([#400](https://github.com/laurentftech/pi-outpost/pull/400))

### Changed

- **A turned-off sandbox shows the shell's lock open.** With `"sandbox": false`,
  the agent's shell runs with every right of the server's account; the lock next
  to the model now says so, instead of showing nothing. Where this machine can
  confine the shell, it offers `pi-outpost config --confine`, which now turns
  the sandbox back on (after checking the runner) and tells you that the
  agent's file tools are limited to the project again.
  ([#402](https://github.com/laurentftech/pi-outpost/pull/402))
- **Pi SDK 1.5.0.** The npm CLI and server use the updated SDK, which also brings
  the `undici` security fix it had been pinning out.
  ([#399](https://github.com/laurentftech/pi-outpost/pull/399))

### Fixed

- **Messages sent in quick succession reach the agent in the order you sent
  them.** A message naming files with `@` could be overtaken by a plain one
  sent right after it.
  ([#401](https://github.com/laurentftech/pi-outpost/pull/401))
- **A message queued before a stop no longer vanishes.** It disappeared from the
  screen while the agent kept it and sent it with your next message; it now
  stays visible, and can be changed, removed or sent.
  ([#400](https://github.com/laurentftech/pi-outpost/pull/400))

## [0.56.0] - 2026-11-01

### Changed

- **The agent is now sandboxed by default.** This is the main change of this
  release. If your configuration has no `sandbox` section, the agent can now read
  and write only inside the project, and its shell runs in the operating
  system's sandbox: MXC on Windows and Linux, Seatbelt on macOS. Commands run
  once the sandbox has passed its check; where it cannot confine — a Windows 11
  build without the August 2026 update, a container without user namespaces —
  the shell refuses every command and says why. To get an unconfined shell
  back, set `"bashRunner": "none"` in `sandbox`; to turn the sandbox off
  entirely, `"sandbox": false`. A configuration that already has a `sandbox`
  section behaves as before. The agent can no longer write pi-outpost's
  configuration file, and `pi-outpost init` writes this default out.
  ([#397](https://github.com/laurentftech/pi-outpost/pull/397))
- **A shorter README.** Setup, configuration, the command line, features,
  deployment and integrations each have their own guide under `docs/`.
  ([#398](https://github.com/laurentftech/pi-outpost/pull/398))
- The draw.io viewer is updated to 32.6.9.
  ([#386](https://github.com/laurentftech/pi-outpost/pull/386))

### Added

- **Confine an unconfined shell in one command.** When your configuration runs
  the shell unconfined and this machine can confine it, the lock next to the
  model is highlighted and says so; `pi-outpost config --confine` checks the
  sandbox, then switches it on in your configuration file.
  ([#397](https://github.com/laurentftech/pi-outpost/pull/397))
- **Let a confined command through, once or for the session.** When a sandboxed
  command connects to a host that is not allowed, or the agent needs a folder
  beside the project, you are asked, and choose this command only, this session,
  or no. The agent directory, the configuration and `.pi` folders are never
  offered. ([#392](https://github.com/laurentftech/pi-outpost/pull/392))
- **Run one turn from the terminal.** `pi-outpost -p "<prompt>"` answers on
  stdout and exits, without a browser; `-p -` reads the prompt from stdin and
  `--json` prints every event.
  ([#395](https://github.com/laurentftech/pi-outpost/pull/395))
- **Search file contents from the Files panel.** The magnifying glass searches
  text files and the text of PDFs; a hit opens the file at the match.
  ([#385](https://github.com/laurentftech/pi-outpost/pull/385))
- **Graphs with straight, readable wires that keep their layout.** Structured
  graphs are drawn with right-angled wires routed like draw.io's, and a layout you
  adjust — by dragging, or touched up in draw.io — is kept beside the document and
  reused when the model is revised.
  ([#390](https://github.com/laurentftech/pi-outpost/pull/390))
- **`drawio_check` checks where wires meet.** It warns about wires that share a
  point while carrying different data, exits facing the wrong way, long detours
  and needless bends, with advice that settles the diagram.
  ([#389](https://github.com/laurentftech/pi-outpost/pull/389))

### Fixed

- **Tools installed for your user run in the Windows sandbox.** A confined
  command finds what `PATH` finds (Python in your profile, for example), and a
  bare `sandbox.bashShell` such as `pwsh.exe` is looked up on `PATH`.
  ([#393](https://github.com/laurentftech/pi-outpost/pull/393))
- **The PowerShell confinement check reports again**, instead of always showing
  "confinement unchecked". ([#388](https://github.com/laurentftech/pi-outpost/pull/388))
- **Two arrangements saved at once both stick on Windows.**
  ([#394](https://github.com/laurentftech/pi-outpost/pull/394))
- **`drawio_check`'s advice is read in linear time**, whatever a diagram's labels
  hold. ([#396](https://github.com/laurentftech/pi-outpost/pull/396))

## [0.55.0] - 2026-10-29

### Added

- **Ask a side question while the agent works.** Use `/btw` to ask about the
  conversation without interrupting the running turn. The answer appears above
  the composer, supports follow-up questions, and stays out of the agent's
  conversation and saved session. Side answers use the session's model with no
  tools, in both embedded and RPC runtimes.
  ([#383](https://github.com/laurentftech/pi-outpost/pull/383))

### Changed

- **Load specialist tools when they are needed.** Document and project-model tools
  stay available through `tool_search` and extension calls without adding all their
  schemas to every request. Tools loaded by search follow the same inactivity
  rules as tools published when a document is named.
  ([#382](https://github.com/laurentftech/pi-outpost/pull/382))
- **Keep diagram, poster and structure tools out of idle conversations.** These
  tools now load through `tool_search` too, with guidance explaining which tool
  families the agent can find.
  ([#384](https://github.com/laurentftech/pi-outpost/pull/384))

### Fixed

- **Keep on-demand tools hidden across conversation rewinds.** Restoring or
  rewinding a conversation no longer republishes tools that should stay inactive.
  ([#381](https://github.com/laurentftech/pi-outpost/pull/381))
- **Find the Word extractor on Windows.** Searching for “Word document” includes
  `docx_extract` even when the Windows-only comparison tool is available.
  ([#384](https://github.com/laurentftech/pi-outpost/pull/384))

## [0.54.0] - 2026-10-28

### Added

- **Drop desktop files straight into a workspace folder.** Drag files onto a folder
  in the Files tree, or onto Workspace root, to import them there without attaching
  them to the conversation. Progress, saved paths and individual errors stay visible
  when you close and reopen Files. Existing names receive a numeric suffix instead
  of being overwritten. Imports accept files up to 25 MB; folder drops and read-only
  destinations are refused, and changing workspace stops the remaining batch.
  ([#379](https://github.com/laurentftech/pi-outpost/pull/379))

## [0.53.0] - 2026-10-28

### Added

- **Touch up a poster's draw.io diagram in place.** In pi-outpost, double-click a
  diagram picture to edit its page, or open it in draw.io desktop. Returning to the
  poster refreshes every picture of that page, keeping its position and width;
  one undo restores them all. Unsaved touch-ups are kept unless you discard them.
  ([#376](https://github.com/laurentftech/pi-outpost/pull/376))
- **See why a session is slow to open.** A new session, session switch or fork taking
  at least two seconds logs the time spent shutting down the previous session,
  loading the new one and binding extensions. An extension binding that finishes
  later reports its completion too, helping diagnose slow MCP connections.
  ([#377](https://github.com/laurentftech/pi-outpost/pull/377))

### Fixed

- **The poster's Format panel starts from what you see.** Inherited fonts, sizes,
  colours and alignment are shown correctly, and the size arrows step from those
  values without accidental dragging. Font sizes stay positive and in pixels,
  line spacing is a multiple of the text size, and invalid colours are refused.
  The panel follows the light or dark theme and its colour picker stays in view.
  ([#375](https://github.com/laurentftech/pi-outpost/pull/375))

## [0.52.0] - 2026-10-27

### Added

- **draw.io diagrams in posters.** In the poster editor, **Insert ▾ → draw.io diagram…** lists
  the project's diagrams page by page and puts the one you choose into the selected frame or
  onto the page. The agent can lay out a frame naming a diagram, and the editor draws it when
  the poster opens. ([#370](https://github.com/laurentftech/pi-outpost/pull/370))
- **The project's pictures in posters.** **Insert ▾ → Picture from the project…** lists the
  project's SVG, PNG, JPEG, GIF and WebP files, including the figures the agent drew. An SVG
  stays sharp at any size; the agent can name a picture file in a frame too.
  ([#371](https://github.com/laurentftech/pi-outpost/pull/371))
- **The agent checks its posters.** After writing a poster, the agent runs `poster_check`,
  which says what the editor would refuse, drop or leave empty, so it fixes the poster before
  you open it. ([#373](https://github.com/laurentftech/pi-outpost/pull/373))
- **Wires that cross boxes are caught.** `drawio_check` now warns when a wire runs through a
  box or its label sits on one, so the agent can tidy its diagram. In touch-up, a **wires**
  control draws the selected wires, or all of them, straight, orthogonal or curved.
  ([#374](https://github.com/laurentftech/pi-outpost/pull/374))

### Fixed

- **A poster open in the viewer shows the agent's new version** as soon as it rewrites the
  file, unless you have unsaved touch-ups, which are kept. ([#369](https://github.com/laurentftech/pi-outpost/pull/369))
- **Posters with text pasted from Word export to Word and PowerPoint** instead of failing with
  "this browser could not draw the page as a picture"; an export that still fails says why.
  ([#372](https://github.com/laurentftech/pi-outpost/pull/372))
- **Opening a poster no longer asks to discard changes you never made**, when the editor filled
  frames on opening. ([#373](https://github.com/laurentftech/pi-outpost/pull/373))
- **No more stray "git log failed" at the bottom of the conversation.** The commit map only
  follows the repository while its menu is open, and a failure shows in the menu, saying why
  git failed (too slow, not found, too much output). ([#368](https://github.com/laurentftech/pi-outpost/pull/368))

## [0.51.0] - 2026-10-26

### Added

- **Pictures, text boxes and shapes in posters.** In the poster editor, **Insert ▾** adds a
  picture from your computer, a text box or a shape (rectangle, ellipse, arrow, star, speech
  bubble…). Double-click an empty frame the agent laid out, or drop a file on the page, to put
  a picture in it. Pictures are shrunk to 1200 px and kept inside the poster file, and they
  still go out with it to Word and PowerPoint.
  ([#365](https://github.com/laurentftech/pi-outpost/pull/365))
- **The agent keeps your pictures and can draw.** The agent reads each picture as a short
  marker and puts the picture back when it edits the poster, so its edits never drop one. It
  can also lay out empty frames for your pictures and draw simple illustrations, which move
  and resize as one piece. ([#365](https://github.com/laurentftech/pi-outpost/pull/365))
- **Open WebUI's model can look at a poster's pictures.** With a model that reads images,
  `get_poster` can hand it the poster's pictures as images.
  ([#366](https://github.com/laurentftech/pi-outpost/pull/366))

### Fixed

- **The poster page stays still under your clicks.** The page is kept in view after you
  scroll, pinch or zoom, without ever fighting the editor's own fit, so a click on a text or
  a drawing selects it at once. ([#367](https://github.com/laurentftech/pi-outpost/pull/367))

## [0.50.0] - 2026-10-25

### Added

- **Posters you can retouch.** Ask the agent for a poster, a worksheet or a slide and it
  writes a printable `.poster.html` page (A4, A3 or 16:9). The file viewer opens it in an
  editor: double-click a text to correct it, drag a pictogram, change colours, fonts and
  sizes, then save it back to the file. Unsaved touch-ups are not dropped without asking.
  ([#361](https://github.com/laurentftech/pi-outpost/pull/361))
- **Posters to Word and PowerPoint.** From the editor, download the poster as a Word page,
  a PowerPoint slide or HTML. In Word and PowerPoint the poster is a picture at print
  resolution: correct texts in the editor, then export again.
  ([#361](https://github.com/laurentftech/pi-outpost/pull/361))
- **Posters in Claude Desktop.** A second extension, `pi-outpost-posters.mcpb`, attached to
  each release, shows the same editor inside Claude.
  ([#361](https://github.com/laurentftech/pi-outpost/pull/361))
- **Posters in Open WebUI.** The tool server creates, shows and lists posters for each user.
  When saving is configured, touch-ups made in the embed are kept as a new revision that
  the model reads back; an older embed cannot overwrite a newer revision.
  ([#361](https://github.com/laurentftech/pi-outpost/pull/361),
  [#362](https://github.com/laurentftech/pi-outpost/pull/362))

### Changed

- **Open WebUI embeds follow the host theme.** Planning and poster views switch between
  light and dark with Open WebUI. ([#362](https://github.com/laurentftech/pi-outpost/pull/362))

### Fixed

- **Extension statuses keep their semantic colours.** Statuses an extension styles as
  success, warning or error (pi-blackhole's gauges, for instance) are shown in colour
  instead of plain text, including in the standalone executables.
  ([#360](https://github.com/laurentftech/pi-outpost/pull/360))
- **Dependency security updates.** `fast-uri` 3.1.9 fixes four URI parsing advisories;
  `undici` moves to 8.12.3. ([#363](https://github.com/laurentftech/pi-outpost/pull/363),
  [#364](https://github.com/laurentftech/pi-outpost/pull/364))

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
