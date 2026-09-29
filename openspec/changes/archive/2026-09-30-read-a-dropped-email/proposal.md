## Why

An email dropped on the composer is the one document class this system cannot read, and it is
the one that carries all the others. A `.msg` dragged out of Outlook trips the NUL-byte check in
`attachInlineText` and is refused as "unsupported binary file"; a `.eml` dragged out of macOS Mail
is worse — under 512 KB it takes the inline-text branch, so the prompt pays for raw MIME headers
and the base64 blob of every attachment, and the agent is handed an encoded wall rather than a
message. Either way the deck, the contract or the report that was the point of forwarding the mail
is unreachable, although extractors for all four of those formats already exist.

## What Changes

- **New `mail_extract` tool**: given the workspace path of a `.msg`, `.eml` or `.emlx`, it returns
  the message as markdown — from, to, cc, date, subject, the body, and an inventory of the
  attachments with their names, types and sizes. Bounded and writable to a file through the same
  `output_path` contract the other extractors use.
- **Attachments are unpacked into workspace files, not extracted inline.** `mail_extract` writes the
  requested attachments into a directory beside the message and returns their paths, so
  `pdf_extract`, `docx_extract`, `xlsx_extract` and `pptx_extract` read them exactly as they read
  any other workspace file. Nothing about their formats is reimplemented here.
- **The extractors for the kinds just unpacked are published inside the same turn.** Today an
  extractor is the user's to bring back by naming a document, and an agent's own tool call never
  republishes one. An unpacked attachment is the exception the rule was not written for: the file
  provably exists, because this system just wrote it, and the path the agent must now read was never
  available for the user to name.
- **A dropped or attached email is routed as a path reference**, like a PDF: copied into the
  workspace, referenced by path, never inlined and never refused as an unsupported binary. Naming
  one in the prompt publishes `mail_extract`.
- **A mail-specific size limit**, configurable as `mail.maxBytes`, defaulting to 25 MiB — an
  emailed deck routinely exceeds the 1 MiB that governs ordinary raw reads.
- **Out of scope, deliberately**: rendering the message in the file viewer. Selecting a `.msg` in the
  tree keeps reporting unpreviewable binary content — it gains only the automatic path attachment
  that every tool-readable binary already gets. Replying to, composing or sending mail is not part
  of this change either.

## Capabilities

### New Capabilities
- `email-messages`: reading an `.msg`, `.eml` or `.emlx` at a workspace path — its headers, its body
  as markdown, its attachment inventory, and unpacking those attachments into workspace files the
  existing document extractors can open.

### Modified Capabilities
- `composer-file-upload`: the routing table gains the email formats. An email is a file with a
  path-based extraction tool, so it is copied in and referenced by path — including a small `.eml`,
  which must stop taking the inline-text branch that carries its MIME source into the prompt.
- `agent`: an extractor is also published when this system writes a document of that kind into the
  workspace on the agent's behalf, which is what unpacking an email's attachments does. The
  existing rule — extractors are the user's to bring back, an agent's own call never republishes
  one — otherwise leaves the agent holding a deck it cannot open.

## Impact

- **New**: `server/src/mail.ts` (the `.eml`/`.emlx` MIME reader and the `.msg` CFB reader),
  `server/src/mailTool.ts` (the tool definition), tests for both.
- **Modified**: `server/src/documentTools.ts` (the `EXTRACTORS` map, the `MENTION` extension list,
  and the publication triggered by an unpack), `server/src/config.ts` (`mail.maxBytes`),
  the three tool registration sites — `server/src/index.ts`, `server/src/piOutpostTools.ts`,
  `server/src/sandbox.ts` — and, in the client, `ui/src/util/workspacePath.ts`
  (`hasPathExtractionTool`) with `ui/src/attachments.ts` following from it.
- **Dependencies**: none added. MIME, CFB and LZFu are parsed in this repository's own idiom, as
  ZIP, OOXML and XML already are.
- **Docs**: the document-reading section of `README.md` and `docs/`, and the configuration
  reference for the new limit.
