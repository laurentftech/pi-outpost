# Design

## Context

See `proposal.md` — Why. The structural facts that shape the approach:

- **The routing is one line from working.** `classifyDroppedFile` in `ui/src/attachments.ts` tests the
  extraction-tool extensions *before* the inline-text size branch, so adding the mail extensions to
  `hasPathExtractionTool` (`ui/src/util/workspacePath.ts`) is enough to make a dropped `.msg` or `.eml`
  upload and travel as `@path` instead of being inlined or refused.
- **The extractor pattern is settled.** `server/src/pdfTool.ts` is the reference shape: options carrying
  `cwd`, `allowedRoots`, `maxBytes` and `writableRoot`; `path` named exactly that so `scopeToRoot` in
  `sandbox.ts` confines it; a second `realResolve` + `isWithinAny` check for the non-sandboxed path;
  `assertWritableDestination` / `writeExtraction` / `extractionSummary` / `excerptOf` from
  `extractionOutput.ts` for the `output_path` contract; registration at three sites — `index.ts`,
  `piOutpostTools.ts`, `sandbox.ts`.
- **Extractor publication deliberately excludes the agent.** `documentToolsForToolCall` publishes the
  *presentation* and *Word* tool families from a tool call, and its comment states the rule: "the
  extractors stay the user's to bring back by naming a document … nothing the agent does republishes
  `pptx_extract`." An unpacked attachment is a document arriving by a route that rule never
  contemplated — hence the `agent` spec delta, and a mechanism that publishes on the *write*, not on a
  mention.
- **No mail, MIME, CFB or HTML-parsing dependency exists.** ZIP, OOXML, XML and WordML are all read by
  hand in `server/src/`; `pdfjs-dist` is the single parsing dependency, and it earns that by being a
  PDF engine.
- **The server ships as a single executable.** `build:sea` bundles it with esbuild, so every dependency
  is a bundling and licence question, and a native or ICU-dependent one is a portability question.

## Goals / Non-Goals

**Goals**

- One tool, `mail_extract`, that reads `.eml`, `.emlx` and `.msg` at a workspace path and answers with
  headers, body and an attachment inventory.
- Attachments reachable as workspace files, so the four existing extractors read them unchanged.
- The agent able to open an attachment it has just unpacked, in the same turn, without the user naming
  the file.
- Nothing new in the prompt floor for a session that never touches mail.

**Non-Goals**

- No viewer rendering, no mail UI, no reply/compose/send, no mailbox formats (`.mbox`, `.pst`, `.olm`).
- No signature or DKIM verification, no decryption.
- No OCR of an attached scan — `pdf_extract` already decides that for itself.
- No re-implementation of any document format inside the mail reader: an attachment is a file on disk
  and nothing more.

## Decisions

### One module, two readers, format decided by bytes

`server/src/mail.ts` exposes a single `readMessage(bytes)` returning a format-neutral shape —
headers, chosen body with the form it came from, and parts — behind two readers:

- **MIME** for `.eml`, and `.emlx` after stripping its leading ASCII byte-count line and trailing
  property list.
- **CFB** for `.msg`: the compound-file container, then the `__substg1.0_*` property streams and the
  `__attach_version1.0_#…` storages.

Sniffing is on magic bytes — the CFB signature `D0 CF 11 E0 A1 B1 1A E1`, an `.emlx` count line, else
MIME — because the spec requires a misnamed message to be read, and because `.msg` files arrive from
Windows shares with whatever extension someone gave them.

*Alternative considered*: dispatch on extension. Rejected: it is the one input we know to be
unreliable, and sniffing costs eight bytes.

### No new dependency

`mailparser` is the obvious candidate and drags in `iconv-lite`, `html-to-text`, `nodemailer`'s
shared internals and a tree this repository has consistently declined; `@kenjiuno/msgreader` covers
only `.msg`. Between them they would add more code to the SEA bundle than the readers do, for formats
this repository already parses harder things than.

*Consequence*: LZFu decompression and single-byte character decoding are ours to get right, and both
appear in Risks.

*Escape hatch*: the readers sit behind `readMessage`, so swapping one for a library later is a
module-local change.

### HTML reduced with a tag scanner, not a DOM

Email HTML is Word-generated tag soup; what is wanted is *reduction* to markdown, not fidelity — so
the reducer walks a flat event stream with its own stack, as `docx.ts` walks `scanXml`, rather than
building a DOM.

It does **not** reuse `scanXml` itself, which the first draft of this design assumed it would. That
scanner is deliberately strict in three ways that are all ordinary in mail: it throws on a DOCTYPE
(`<!DOCTYPE html>` opens most HTML mail), it throws on an unterminated tag, and it treats a bare `<`
in prose as the start of one. A parser that refuses those refuses the body. `mailHtml.ts` therefore
carries `scanHtml`, the tolerant sibling — it never throws, and anything it does not recognise as
structure becomes text — while `decodeEntities`' job is done by a `decodeHtmlEntities` that also
knows the named entities mail actually uses (`&nbsp;`, and `&eacute;` and its accented siblings,
which are how a French message from a non-Unicode client arrives).

On top of the scanner the reducer is an event handler with a small mapping: block tags to blank lines,
`h1`–`h6` to headings, `li` to bullets, `table`/`tr`/`td` through the existing `markdownTable.ts`,
`a href` to a markdown link, `script`/`style`/`head` skipped whole.

*Alternative considered*: `rehype-parse` + `rehype-remark`, which would fit the `unified`/`remark`
stack already in `server/package.json`. It parses real HTML properly, and it is the better answer if
the scanner proves inadequate on real mail — recorded here as the known upgrade, not taken now
because it is two more dependencies for a reduction that discards most of what a parser preserves.

*Constraint from the spec*: no text may be lost to the reduction, so an unrecognised tag contributes
its text content rather than being dropped.

### Unpacking is a parameter on `mail_extract`, not a second tool

`attachments: "none" | "all" | string[]` mirrors `imagesParameter` / `PictureRequest` in
`extractedPictures.ts`, which the model already meets on `pdf_extract`. One tool keeps one schema in
the prompt, and the inventory and the unpack share a single parse of the message.

Attachments are written to `<message-path>.attachments/` — a sibling directory derived from the
message's own name, which gives the spec's no-collision and traceable-origin properties without a
new configuration key or a shared dumping ground. Names are sanitized to a single path component
(reusing the rules `assertUploadName` enforces for uploads), the destination goes through
`assertWritableDestination`, and each file is written with `wx` so an existing file is a refusal and
not an overwrite — the same primitive `writeExtraction` uses.

*Alternative considered*: unpack into the uploads directory. Rejected: it mixes files the user
supplied with files a message carried, and loses which message a file came from.

### Publication on the write, through a callback

The tool cannot publish a tool: it holds no workspace. `MailToolOptions` therefore takes an optional
`onDocumentsWritten?: (paths: string[]) => void`, which `index.ts` wires to the existing
`publishToolDuringTurn`, mapping each written path through the `EXTRACTORS` table in
`documentTools.ts`.

*Alternative considered*: extend the tool-result hook to scan `mail_extract`'s output text for paths.
Rejected: it would make the trigger a text match over our own output — the very weakness the spec
delta distinguishes itself from — and the callback makes "the trigger is the write" true by
construction.

The callback is wired on **both** toolset paths — the unsandboxed branch of `makeCreateRuntime`, and
`createSandboxedTools` through a new `onDocumentsWritten` option on `WorkspaceOptions`. The first
draft wired only the unsandboxed one, reasoning that a sandboxed toolset has no session to publish
into; that was wrong twice over. A sandbox is what a real deployment configures, and it is what this
project's own test harness configures by default — so the feature was dead in the configuration that
matters, and a passing unit suite said nothing about it. The wire test in `mailToolsWire.test.mjs` is
what found it, by driving a real turn and reading the tool list the provider was sent.

`piOutpostTools.ts` does leave the callback unset, and correctly: the RPC runtime cannot change its
published toolset, so it carries every document tool at all times, as the `agent` spec requires.

The workspace reaches the callback through a function (`publishWrittenDocuments(() => workspace)`)
because these callbacks are built while the workspace is still being constructed — the same shape
`onDirectoryChanged` already uses at every one of those sites.

### Limits and registration follow the other extractors

`mail.maxBytes` joins `pdf`/`docx`/`xlsx`/`pptx` in `config.ts` with a 25 MiB default, checked before
parsing. `mail_extract` is registered at all three sites and added to `EXTRACTORS` for `msg`, `eml`
and `emlx`, and to the `MENTION` extension alternation so naming a message publishes it.

Adding the extensions to `hasPathExtractionTool` also makes selecting a message in the file tree
attach it automatically, through the existing "tool-readable binary selections" requirement in
`preview-file-attachments`. That is a consequence, not a new behaviour, and needs no spec change.

### Fixtures

`.eml` fixtures are checked in as text and the parser accepts both `CRLF` and `LF`, because a
checked-in text file arrives with `CRLF` on the Windows CI runners. `.msg` fixtures are binary: a
script under `server/test/` builds a minimal CFB message once, the result is committed with a
`.gitattributes` `binary` rule, and a small CFB writer helper in the test harness covers the edge
cases (non-Unicode properties, RTF-only body, hostile attachment name) without committing a fixture
per case.

## Risks / Trade-offs

- **LZFu-compressed RTF is ours to decompress, and an RTF-only body is the format's messiest corner.**
  → The spec requires the form read to be named and an unreadable body to say so, so a failure
  degrades to an honest report rather than to plausible garbage. Encapsulated HTML — the common case —
  is recovered through the same reducer as an HTML body.
- **`windows-1252` / `ISO-8859-1` decoding depends on `TextDecoder` having those encodings.** Node ships
  full ICU, but the SEA build is where that assumption would break, and silently: accented French
  subjects would come back as replacement characters. → A built-in single-byte table for
  `windows-1252` (a superset of Latin-1, covering the overwhelming majority of non-UTF-8 mail) with
  `TextDecoder` used only when it is actually available, and a test asserting accented output.
- **A reduction of Word-generated HTML will sometimes read poorly.** → No text is dropped: an
  unrecognised construct contributes its text. The failure mode is ugly markdown, never missing
  content.
- **Attachment names are attacker-controlled.** → Single-component sanitization plus the symlink-safe
  resolve and `wx` write; a scenario exists for `../../.ssh/authorized_keys`.
- **Mail content is the canonical prompt-injection vector**, and this change puts a stranger's prose in
  front of the agent with its attachments. → The untrusted-content statement ahead of the body, no
  network fetch, no script execution, and references reported rather than followed.
- **Unpacking writes into the workspace, which dirties git.** → Only on request, never on drop, and
  under a directory named after the message so what appeared and why is obvious.
- **Dragging a message straight from the Outlook desktop app into a browser may deliver no file at
  all** — Outlook offers its own clipboard format rather than a file handle, depending on version. →
  Outside this change's control; the documented paths that always work are dragging the message to a
  folder first, or picking the saved `.msg` through the composer's attach button. Worth one sentence
  in the docs so the failure is not mistaken for this feature being broken. Dragging from macOS Mail
  yields a `.eml` and is unaffected.
- **`mail_extract` will be published for a `.eml` that turns out to be something else.** → One wasted
  tool definition for one turn, which is exactly the cost the existing withdrawal rule is designed
  around.

## Open Questions

- Whether a mail *viewer* follows. It would be a separate change and would not alter any requirement
  here: the tool, the inventory and the unpacking are what the agent needs either way.
