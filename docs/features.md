# Features and workspace

[Home](../README.md) · [How-to](how-to.md)

- [What you get](#what-you-get)
- [Integrated Terminal](#integrated-terminal)
- [Work Plans](#work-plans)
- [Workspace Outcome](#workspace-outcome)

## What you get

### The conversation

- Streaming answers in markdown, with collapsible thinking blocks, mermaid diagrams, math,
  inline images and clickable workspace file links. A diagram too wide to read in the column
  is drawn down the page instead, whichever direction its source asked for, and says so — one
  click puts it back. Mermaid controls stay visible below the picture, including an SVG
  download for documents. In the full-size view, export actions stay at the bottom left
  while the diagram scrolls
- Sections an extension appends to an answer render as real markup — a `<details>` block of
  sources folds away, and its classes reach a host page's CSS. Reply text is untrusted whoever
  wrote it, so all of it is filtered first: scripts, event handlers, `javascript:` links, styles,
  frames and forms never reach the page
- Tool cards with live output and, for tools that report it, a progress bar. One toggle
  hides them all when they drown the conversation, and the preference sticks
- Results rendered by what they are, not by which tool produced them: a `git diff` becomes
  per-file diffs with `open` and `history` beside each path, a search becomes hits grouped
  by file, an edit becomes the diff it applied — the raw output always one keystroke away
- Steer or follow up while the agent is streaming, and abort
- Ask a side question while the agent works: `/btw where are you at?` is answered from the
  conversation so far, in a side note above the composer, without interrupting the turn, reaching
  the agent or entering the conversation. Another `/btw` can follow up on it; × closes the note
  and forgets the side questions
- Model and thinking-level selectors; tokens and price per turn, plus a session-analysis
  panel — cost across turns, tool calls ranked by output size or failure, every row jumping
  back to the message that produced it
- Sessions: list, resume, rename, delete, and full-text search across saved transcripts
- Conversation tree: edit a past message to re-ask it; the old exchange stays reachable as a
  branch you can navigate back to
- Slash commands (`/`) and file mentions (`@`) with autocompletion, and a button back to the
  latest message when you have scrolled up
- Read the whole conversation back: when the context window fills, the agent compacts the
  exchange and carries on from a summary — the transcript says where that happened, and
  **Load earlier messages** brings back what it removed, from the session's own record, without
  moving the message you were reading. Recovered messages are read-only: their turns are no
  longer in the model's context, so they cannot be edited or forked from until you navigate
  back to them in the conversation tree
- Take the conversation away: **↓ html** saves the whole exchange — everything above the
  compaction point included — as one self-contained HTML file. It opens with no network, no
  application and no JavaScript: images and diagrams travel inside it, equations as MathML,
  tool calls as sections you unfold. Either the file holds the whole conversation or there is no
  file; nothing is written into the workspace
- Attachments: drop or paste images and text files into the composer. A PDF, `.docx`,
  `.xlsx` or `.pptx` is uploaded into the workspace and attached as a **path**, so the agent
  reads it with its extraction tools instead of the prompt carrying its content

### The workspace

- [Several projects open at once](configuration.md#projects), each with its own agent, sandbox, sessions and
  history — switch between them while work continues in the ones you are not watching, and
  get a browser notification when a background project needs an answer or is ready for review
- Import files by dropping them on a writable folder in the file tree, or on its **Workspace root**
  target. Files are copied there without being attached to the conversation. The tree shows progress,
  saved paths and individual errors; existing files are kept and duplicate names get a numeric suffix.
  Each file is limited to 25 MB. Drop files rather than folders; read-only destinations refuse imports.
- File browser: lazy-loaded tree, syntax-highlighted viewer, Markdown rendering, and a code
  editor (CodeMirror) that saves inside the writable zone — line numbers, syntax colours,
  brackets closed and matched, Tab / Shift+Tab, several cursors (Ctrl+D, Alt-click), Alt+arrows
  to move lines, Ctrl+/ to comment, folding; Ctrl+S (Cmd+S) saves and stays in the editor, and a
  CRLF file is saved with CRLF. A file's source, when read rather than edited, is shown in the same
  editor, read-only. Create, rename, move, copy, delete, open a
  file with the system's own application, or show a file or folder in Finder, Explorer or
  the Linux file manager; anything outside the writable zone is dimmed.
  Ctrl+F (Cmd+F) finds text in the open file — source, rendered Markdown, or a live edit
- **Search in files** (the magnifying glass in the Files header) finds text across the project:
  case-insensitive, literal, in text files and in the text layer of PDFs. Each hit shows its line
  or PDF page with an excerpt; clicking it opens the file there with the match highlighted. See
  [Search the project's files](how-to.md#search-the-projects-files).
- Opening a file only previews it; it does not attach it to your next message. Use the
  file tree’s reference button, an `@` mention, or **Attach files** to add context explicitly.
- HTML files open rendered, as Markdown does: the page's scripts run, and its stylesheets,
  pictures and scripts next to it in the workspace are loaded. A relative link opens that file
  in the viewer, an absolute one a new tab. The page is drawn in a sandboxed frame with an
  opaque origin, so it reaches neither the application, its access token nor the server
- Word export: any text file open in the viewer downloads as a real `.docx` — except a
  structured-exchange document, whose toolbar exports what it draws instead: a graph, sequence or
  timeline as SVG, a table as a Word table and an Excel workbook. Markdown becomes
  Word's own structure — headings as chapter levels (navigation pane, table of contents), lists,
  tables, hyperlinks — LaTeX becomes native Word
  equations you can edit in the equation editor, and mermaid diagrams travel as vector images
  that stay sharp, with a raster behind them for readers that do not draw SVG. A figure the
  document references — beside it, below it or above it — is carried as a picture under the same
  rule; one that cannot be read keeps its alt text, and an image referenced by an absolute URL is
  never fetched. Any other text
  file exports as monospaced lines. It is a download, so a read-only file offers it too, and
  the writer is fetched only when you first use it. With a Word template configured
  (`docx.template`), a second button writes the same document into the template — its styles,
  heading numbering, page setup, header and footer; if the template cannot be used, that button
  says why and the plain export still works
- Split view: a Markdown, HTML, draw.io or structured document renders beside the editor, following what
  you type rather than what was last saved
- Posters: a `.poster.html` file — a poster, a worksheet or a slide the agent writes in HTML,
  guided by the bundled `posters` skill — opens in the poster editor. Double-click a text to
  correct it (it rewraps), drag a pictogram, change colours, fonts and sizes in **Format**, undo,
  zoom and fit. **Insert ▾** adds your own pictures (also by double-clicking an empty frame the
  agent laid out, or by dropping a file on the page), text boxes and shapes; pictures are shrunk
  to 1200 px and kept inside the file, and the agent reads each one as a short marker
  (`poster-picture:1`) that it keeps when it edits the poster; with a model that reads images,
  `poster_pictures` lets it look at them. The agent checks each poster it writes with `poster_check` —
  a page the editor would not open, pictures pointing at a file or the web (a poster fetches
  nothing: a diagram or picture of the project goes in a frame naming it), what the editor removes,
  frames naming a file or page that does not exist — since it cannot see the poster.
  Double-click a draw.io diagram in the poster to touch it up over the poster, or to open it in
  draw.io desktop: back on the poster, every picture of that page shows it as saved. **💾** saves back to the file, refused if it changed on disk meanwhile, and the
  viewer asks before dropping unsaved touch-ups. **💾 Save** is disabled until you make a change.
  **↓ word** gives an A4 page to print,
  **↓ powerpoint** a 16:9 slide, **↓ html** the page itself — the poster as a picture at print
  resolution. The editor runs under its own Content-Security-Policy: a poster's scripts and
  remote images do not run or load. The same editor is the Claude Desktop extension's
  ([docs/claude-desktop.md](claude-desktop.md)).
- draw.io diagrams: a `.drawio` file opens drawn, by draw.io's own viewer, with every page and zoom,
  offline — it runs in a sandboxed frame allowed no connection at all, so a diagram's remote images
  or fonts are simply not fetched. A reply that references one as a picture
  (`![overview](./diagrams/overview.drawio)`) draws it in the conversation too, with the controls
  every diagram has — ⤢ enlarge, ⤓ download SVG (the page shown), ⤓ download .drawio, ↗ open.
  **✎ touch up**, in the file viewer and at full size, makes it editable in place: move and resize
  boxes, drag a wire's end to another box or draw a new one from a box's connection points,
  retype a label, delete, undo (⌘/Ctrl+Z), choose how wires are drawn (straight, orthogonal or
  curved: the selected ones, or every wire of the page when none is selected, and new ones, which
  start in the style most of the page's wires have), remove the bends of those wires, or one bend
  with a click on its handle then Delete — then save, which rewrites only the page shown and is
  refused if the file changed on disk meanwhile; Escape leaves, asking first about unsaved
  touch-ups. **Open in draw.io** hands the file to the application associated with it (draw.io
  desktop) for anything more, and the view follows the saved file. The agent writes `.drawio`
  files with its file tools, guided by the bundled `drawio` skill, checks them with
  `drawio_check` — dangling connectors, duplicate ids, missing parents, unusable geometry,
  overlapping labelled shapes, connectors running through boxes or their own ends, connector
  labels on boxes, on other labels or across connectors, connectors carrying different data on
  one point of a shape or along the same line, ends facing away from each other, detours,
  needless bends left by waypoints, with the wires routed as draw.io's viewer routes them —
  since it cannot see the drawing, and shows the result in its
  reply. In a conversation exported to HTML or Word, a diagram is a link to its file
- Git: uncommitted-change badges in the tree, per-file diffs, a change gutter in the editor
  (what changed since HEAD beside each line, as you type; a click shows what was there and,
  while editing, reverts that change into the draft), plus a colored overview beside the
  scrollbar to locate changes throughout the file and jump to one with a click. The commit log is drawn as a metro map
  (the checked-out line and every local branch, with merges, branch names and tags) where a
  click opens the commit, and
  a per-file history graph (renames followed) that diffs any two revisions, working tree
  included. A directory of independently versioned projects works too — each child
  repository answers for its own files. See [Git](configuration.md#git)
- PDF in the viewer (pages, zoom, keyboard paging, Ctrl+F search across the whole document);
  the agent reads its text and tables through `pdf_extract` — no shell, no external binary. A page
  with no text layer is not a dead end: the images it draws are named and can be returned at the
  resolution the file holds, so a scan is readable by looking at it, and `pdf_render` draws a page
  that carries neither text nor an image. There is still no OCR, so a scan's words are not searchable.
  A reviewed PDF's comments — notes, highlights, suggested deletions and insertions, replies and
  review states — come back after each page's content, with their author, date and the text they mark
- Office documents: `docx_extract`, `xlsx_extract` and `pptx_extract` give the agent Word
  text and tables, one markdown table per spreadsheet sheet, and slide structure with
  speaker notes. Every picture is named where it sits, with its format, size and the alt text the
  document declares, and its bytes come back on request — so a report's chart is never simply
  missing from what the agent read. Text a document crosses out comes back as `~~struck through~~` rather than
  as live content — in a `.docx` from the run's own formatting, in a PDF from the strike the
  page draws over the glyphs. A Word document's tracked changes and comments are hidden by
  default — the agent reads the accepted text, told how many changes it holds — and
  `review: true` shows them for an impact analysis: insertions, deletions and moves marked
  where they sit, comments on the text they are about, each listed with its author, date and
  section. Two versions revised without tracked changes are compared by `docx_compare`, on
  Windows: desktop Word compares them (formatting ignored, comments kept), and its result comes
  back in the same review reading, opened by a line saying the authors and dates are the
  comparison's. Elsewhere it is not offered; Word's Review → Compare, then `docx_extract` with
  `review: true` on the result, does the same by hand. Each extractor takes an `output_path`, to write the whole document to a
  file instead of spending the context on it twice. The extractors are described to
  the agent only once a document of that kind is named in the conversation — their schemas
  are a quarter of a session's prompt floor, and most sessions never open one. Named and never
  called, an extractor goes again when the turn ends; named and used, it stays through the
  work around that document and is forgotten after five quiet turns. Naming the document
  again brings it back, and the agent can load one by itself with `tool_search` — for a
  file it found on its own, say
- Email dropped on the composer: an Outlook `.msg`, or a `.eml`/`.emlx` from macOS Mail, Gmail or
  any webmail, is copied into the workspace and read by `mail_extract` — subject, sender,
  recipients, date, the body as markdown, and an inventory of its attachments. Ask for the
  attachments and it writes them into a directory beside the message, so the deck, the contract or
  the report it carried is read by `pptx_extract`, `docx_extract`, `xlsx_extract` or `pdf_extract`
  at a path, and the reader for what was written is offered to the agent there and then. A message
  is content someone else wrote, so every extraction says so before the body, nothing in it is
  fetched or executed, and an attachment's file name is never used as a path as it stands. An
  encrypted message says it is encrypted rather than returning its ciphertext; a signed one is read
  from the signed content and reported as unverified. Dragging a message straight out of the
  Outlook app may hand the browser nothing at all, depending on its version — drag it to a folder
  first, or use the composer's attach button. macOS Mail gives a `.eml` and is unaffected
- PowerPoint decks from a template: `pptx_layouts` lists a `.potx`/`.pptx` template's layouts,
  `pptx_create` builds a deck into them — titles, bullets, PNG/JPEG/GIF/SVG pictures, native
  tables and editable column, bar, line and pie charts, written into the layouts' placeholders so
  the template's fonts, table style and colours apply — `pptx_update` replaces, inserts, deletes
  or moves slides of an existing deck and leaves every other slide exactly as it was, and
  `pptx_render` has **PowerPoint (on Windows)**, LibreOffice or ONLYOFFICE draw it, returning a
  picture of every slide and the text that ran off one. The bundled `pptx-from-template` skill
  makes the agent render and fix its deck before handing it over. See
  [Make a PowerPoint deck from a template](how-to.md#make-a-powerpoint-deck-from-a-template)
- Word documents from a template: `docx_styles` says which of a `.dotx`/`.docx` template's styles
  the content will wear, `docx_create` writes Markdown into the template — its heading styles and
  numbering, lists, tables, pictures, native equations, cover page and table of contents on
  request — `docx_update` changes an existing document section by section, **as tracked
  changes** by default, leaving everything else byte for byte as it was, `docx_restyle` brings an
  existing document into a template — its styles, theme and heading numbering, with the fonts,
  sizes and colours set by hand removed as tracked changes — and `docx_render` has
  **Word (on Windows)**, LibreOffice or ONLYOFFICE draw it, returning the pages, the chapters as
  Word sees them and any text that reached no page. The bundled `docx-from-template` skill teaches
  the loop. See [Write a Word document from a template](how-to.md#write-a-word-document-from-a-template)
- Structured results: a tool can hand back **data** — a graph, a sequence, a table, or a
  planning timeline with milestones, Gantt dependencies and a *Today* line, read by week, month,
  quarter or fitted to the screen, which the agent can compare with an earlier version of the plan — and the
  interface draws it, with an approval gate when the document names a `target`. Files that
  declare the schema open as the diagram they describe, and any graph, sequence or timeline
  exports as a self-contained SVG. A graph with too many boxes to read across is laid out down the page,
  and the reader can turn it either way. A graph's relationships run in straight horizontal and
  vertical segments, routed the way draw.io routes them and tidied by the same wire rules
  `drawio_check` applies. Its layout is kept in a versionable `<document>.arrangement.json` beside the
  document: a box dragged by the reader, a touch-up in draw.io ("arrange in draw.io") and the places
  the agent's figure computes are all kept there. A revised document therefore keeps its layout,
  and only what is new is placed. A graph may name the readings it is made for as
  viewpoints — power, control, safety — which a reader selects and the agent writes one figure
  for. A project can hold the agent's documents to its own data model — kinds, attributes,
  enumeration values, the kinds each relationship joins — declared in local profile files, and
  review them against rules written on top of it; the agent shows those rules back as a register
  and as one small pattern per rule. See [`docs/structured-exchange.md`](structured-exchange.md)
  and [`docs/structured-exchange-project-setup.md`](structured-exchange-project-setup.md)
- [Work Plans](#work-plans): for non-trivial work the agent keeps an explicit hierarchy of
  objectives, dependencies and verification state beside the conversation
- [Workspace Outcome](#workspace-outcome): review plan progress, recorded verification, and
  changed files from one deterministic workspace view

### Setting it up and shipping it

- First run in the browser asks for credentials instead of failing cryptically: sign in when
  the provider supports it, paste an API key, or declare your own OpenAI-compatible endpoint
- [Settings from the browser](configuration.md#settings-from-the-browser): sandbox permissions and roots,
  skill and extension directories — persisted to your configuration file, no restart
- A sandbox that decides what the agent can read, write and run, per project
- [Installable as an app](deployment.md#installing-it-as-an-app), and downloadable as a single executable
  with no Node.js needed
- [Embeddable widget](integrations.md#embedding) (`@pi-outpost/embed`) with its own workspace policy
- Extension "Custom UI" support: dialogs, notifications, status badges, widgets, editor
  prefill
- Two agent runtimes behind the same interface: the bundled pi SDK, or a supervised
  `pi --mode rpc` child process

## Integrated Terminal

When enabled via `--terminal`, `PI_OUTPOST_TERMINAL=1`, or `"terminal": { "enabled": true }` in the configuration file, Pi Outpost provides an interactive pseudo-terminal (PTY) directly in the browser:

- **Full PTY multiplexing**: Real interactive login shells (`bash`, `zsh`, `powershell`) with 24-bit ANSI color and xterm.js emulation over the existing authenticated WebSocket connection.
- **Multi-Tab with inline renaming**: Create tabs (`+`), close them (`✕`), and double-click on any tab title to rename it.
- **Background minimization**: Press `Ctrl+\`` (or `Cmd+\``) or click `>_ terminal` in the header to minimize the panel without interrupting active builds, commands, or logs.
- **1-Click Workspace Repointing**: The terminal detects current working directory (`pwd`) in real time (supporting OSC 7). Clicking `📁 <dir> → open as project` repositions the AI agent, file browser, and git view to that subdirectory.

The terminal runs on [`node-pty`](https://github.com/microsoft/node-pty), an optional
native dependency. It comes prebuilt for macOS and Windows. **On Linux, WSL included, npm
compiles it at install time**, and because it is optional a missing compiler fails
silently: Pi Outpost installs and runs, and only the terminal is missing. Install a
toolchain, then reinstall:

```bash
sudo apt install -y build-essential python3   # Debian, Ubuntu, WSL
npx -y npm@11 install -g pi-outpost
```

Use npm 11 for that install: npm 12 skips install scripts by default, which leaves
`node-pty` unbuilt in the same way. With the terminal enabled, the server says at startup
when `node-pty` will not load, with the same instructions, and `pi-outpost doctor` checks it
again after a reinstall. The standalone executable does not include it at all; install
the npm package for the terminal.


When the server cannot start — a port already taken, an unreadable directory, a bad
configuration — it says which of those it was in a sentence, not a stack trace. A window
launched from a file manager, which would otherwise close with the process and take the
message with it, waits for a keypress first.

## Work Plans

The Work Plan belongs to the agent. For non-trivial work it is its explicit working state: a
persistent hierarchy used to decompose objectives, track execution and dependencies, record
resources and blockers, and reconcile verification before declaring the work complete. It is
not a second activity log, and trivial exchanges need no plan.

Tasks use five states: `todo`, `in_progress`, `blocked`, `needs_review` and `done`. A blocked
or review state can carry a reason, and tasks can link to resources; workspace resources open
directly in the file viewer. The panel is read-only for now, so the conversation stays your
control surface while the agent owns the plan through its `work_plan` tool.

The agent sees that tool in two halves. `work_plan` — creating a plan, adding, updating,
moving and removing tasks — is always there. `work_plan_extended`, which sets a task's
dependencies, resources and verification evidence or replaces the plan wholesale, appears
only once the session has a plan: every one of those operations acts on a task that must
already exist, and their schemas are the expensive half to send on turns that never use
them. It goes again after five turns in which nothing touched the plan, and any later
`work_plan` call brings it straight back — so a plan opened in the morning stops charging
for the afternoon that moved on to something else. A supervised `pi --mode rpc` child gets
both at all times, having no way to change its published toolset.

When a non-empty plan contains at least one `needs_review` task and every other task is either
`needs_review` or `done`, the project becomes **ready for review** in the project selector.
This is derived from the persisted plan, not from a turn or tool merely ending. Opening or
switching to the project does not clear it: tell the agent what you accept or what must change.
Accepted review tasks move to `done`; meaningful resumed work moves the relevant task back to
an active state, so the project stops being ready until it reaches the review boundary again.

Tasks can also carry agent-owned verification or supporting evidence. Each generic record has
an `id`, a free-form `type`, a `result` (`passed`, `failed`, `inconclusive` or
`informational`), and at least a concise `summary` or a resource `reference`. The agent replaces
one task's complete evidence collection with `set_evidence`, preserving older failures when it
wants to append another result:

```json
{"action":"set_evidence","taskId":"build","evidence":[{"id":"tests","type":"test","result":"passed","summary":"Focused tests passed"},{"id":"probe","type":"external-check","result":"failed","summary":"External probe failed"}]}
```

Evidence and status are deliberately independent: evidence never completes or blocks a task,
and marking a task `done` never fabricates evidence. Pi Outpost does not automatically turn tool
activity or conversation claims into evidence; agents record evidence explicitly through the
structured tool.

Each plan is stored beside its session file. It is restored on reconnect and session resume,
replaced when the active session changes, copied when a conversation is forked, and
independent thereafter. Compaction summarizes conversational context only: it never alters
the plan or its evidence. Existing version-1 plans and task inputs without evidence remain valid
and normalize to empty evidence collections. Sessions created before Work Plans open without a
panel.

## Workspace Outcome

The **Outcome** control in the header opens a concise review of the current workspace. It is
available even for older sessions without a Work Plan. The view is assembled directly from
structured state already owned by Pi Outpost: current Work Plan tasks, their recorded evidence,
and current git working-tree status across every repository in the workspace. Opening or
refreshing it does not ask a model to write a summary and does not approve the work.

Plan progress and verification are deliberately separate. Tasks keep their exact status and
reason. Verification is conservative: any failed evidence yields **failed**; otherwise any
inconclusive evidence yields **inconclusive**; otherwise passing evidence yields **passed**.
Informational evidence remains visible but does not prove verification, and no evidence is shown
as **not recorded**. A completed task is therefore not automatically a verified task.

Changed files retain their repository, workspace-relative path, and git state. A clean
repository, no repository, a partially unavailable repository set, and globally unavailable git
status are distinct states—none is presented as successful completion. Select a task to open it
in Work Plan, or select a changed file to open the existing confined file/diff viewer. Safe
HTTP(S) evidence links open externally; unsupported references remain readable text without a
dead control.

Outcome data never crosses workspace boundaries. Refreshes are correlated with the current
workspace and session, so an older response is discarded after a project or session switch, and a
result already on screen is dropped rather than carried into the next one. Switching project
closes the drawer with the project it described; reopening it asks the workspace now bound. An
Outcome left open across a dropped connection is asked for again once the connection is back.
Every request is answered: a composition that fails says why in the drawer, and one the server
never answers is given up on, so **Refresh** always works rather than being disarmed by a request
that stayed outstanding. The
section contract is extensible: future structured sources can add sections without changing the
existing plan, verification, or changed-file sections.
