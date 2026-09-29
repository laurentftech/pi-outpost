# Scenario coverage — read-a-dropped-email

Every `#### Scenario:` in this change's three delta specs, with the test that would fail if the
scenario's contract broke. Enumerated with
`rg '^#### Scenario:' openspec/changes/read-a-dropped-email/specs` — 73 scenarios: 49 in
`email-messages`, 10 in `composer-file-upload`, 14 in `agent`.

Paths are relative to the repository root. A scenario covered in more than one place names the
assertion closest to the boundary the spec describes.

## specs/email-messages/spec.md

### Requirement: ReadAnEmailAtAPath

| Scenario | Status | Test |
|---|---|---|
| ReadAnEmlMessage | covered | `server/test/mail.test.ts` › readMessage: an internet message › "returns the headers a reader needs" |
| ReadAnOutlookMsgMessage | covered | `server/test/mailMsg.test.ts` › attachments › "reads the committed fixture back off disk" (subject, sender, recipients, date, body, attachments of a real compound file) |
| ReadAnEmlxMessage | covered | `server/test/mail.test.ts` › readMessage: an internet message › "reads an .emlx without its count line or its property list" |
| ExtensionDoesNotDecideTheFormat | covered | `server/test/mail.test.ts` › sniffFormat › "decides from the bytes, not the extension" |
| AbsentHeaderIsNamedAbsent | covered | `server/test/mail.test.ts` › "a header the message does not carry is absent, not empty"; the answer's wording in `server/test/mailTool.test.ts` › "returns the headers, the body and the inventory" (`**Cc:** (none)`) |
| PathOutsideSandbox | covered | `server/test/mailTool.test.ts` › "refuses a path outside its zone" |
| NotAMessage | covered | `server/test/mail.test.ts` › "refuses a file that is not a message"; through the tool in `server/test/mailTool.test.ts` › "says why it will not read a file that is not a message" |

Also covered here: `Bcc` when the file holds it — `server/test/mail.test.ts` › "returns Bcc when the
file holds it, as a sent copy does".

### Requirement: MessageBodyAsMarkdown

| Scenario | Status | Test |
|---|---|---|
| PlainTextBody | covered | `server/test/mailMsg.test.ts` › bodies › "prefers the plain-text body"; form named in `server/test/mail.test.ts` › "returns the headers a reader needs" |
| HtmlBodyBecomesMarkdown | covered | `server/test/mailHtml.test.ts` › reduceHtmlToMarkdown › "keeps headings, lists, emphasis and links" and "renders a data table and unwraps a layout table"; end to end in `server/test/mailMsg.test.ts` › "reads an HTML body stored as bytes, honouring its own declared charset" |
| MultipartAlternativePrefersTheRealContent | covered | `server/test/mail.test.ts` › readMessage: structure › "reads the HTML part when the plain one is a stub" (and its converse, "prefers the plain-text part of an alternative") |
| CompressedRichTextWrappingHtml | covered | `server/test/mailMsg.test.ts` › bodies › "recovers the HTML a compressed rich-text body encapsulates" |
| GenuineRichTextBody | covered | `server/test/mailMsg.test.ts` › bodies › "reads genuine rich text as text, and says that is what it read" |
| UnreadableBodyIsNotAnEmptyBody | covered | `server/test/mailMsg.test.ts` › "names the forms it holds when the rich-text body will not decompress"; `server/test/mail.test.ts` › "a body in no form it understands is reported, not returned empty" |
| QuotedHistoryIsKept | covered | `server/test/mail.test.ts` › "keeps the quoted history of a reply, marked as quoted"; the HTML form in `server/test/mailHtml.test.ts` › "marks a quoted reply as quoted" |

### Requirement: HeadersAndBodyAreDecoded

| Scenario | Status | Test |
|---|---|---|
| EncodedWordSubject | covered | `server/test/mail.test.ts` › readMessage: encodings › "decodes an encoded-word subject with its accents" |
| SubjectSplitAcrossEncodedWords | covered | `server/test/mail.test.ts` › "joins a subject split across several encoded words" |
| QuotedPrintableLatin1Body | covered | `server/test/mail.test.ts` › "decodes a quoted-printable Latin-1 body" (asserts no `=E9` and no replacement character) |
| NonUnicodeOutlookProperties | covered | `server/test/mailMsg.test.ts` › properties › "decodes 8-bit properties through the message's code page" |
| UnknownCharacterSet | covered | `server/test/mail.test.ts` › "an unknown character set falls back, and says which part it fell back for"; the table that makes the fallback independent of the runtime's ICU data in "decodeText reads the windows-1252 range without relying on the runtime's tables" |

Also covered here: an unknown Outlook code page — `server/test/mailMsg.test.ts` › "says so when the
declared code page is one it does not know"; an accented attachment name through RFC 2231 —
`server/test/mail.test.ts` › parseStructured › "assembles an RFC 2231 continued, charset-tagged file
name".

### Requirement: AttachmentInventory

| Scenario | Status | Test |
|---|---|---|
| InventoryNamesEachAttachment | covered | `server/test/mail.test.ts` › "lists the attachments of a mixed message with their types and sizes"; `server/test/mailMsg.test.ts` › attachments › "lists each attachment with its identifier, name, type and size" |
| InlineImagesAreDistinguished | covered | `server/test/mail.test.ts` › "distinguishes an inline image from a document attachment"; `server/test/mailMsg.test.ts` › "marks an image the body renders as inline" |
| ForwardedMessageIsAnAttachment | covered | `server/test/mail.test.ts` › "names a forwarded message by its subject"; `server/test/mailMsg.test.ts` › "names an embedded message by its subject and says it has no bytes to unpack" |
| NoAttachments | covered | `server/test/mail.test.ts` › "says so when a message carries no attachments"; the wording in `server/test/mailTool.test.ts` › "says a message carries no attachments when it carries none" |
| UnreadableAttachmentIsStillListed | covered | `server/test/mailMsg.test.ts` › "lists an attachment whose content stream is missing, with the reason" |

Also covered here: identifiers stable in the message's own order — `server/test/mailMsg.test.ts` ›
"identifiers follow the message's own order, not the directory's shape".

### Requirement: UnpackAttachmentsIntoWorkspaceFiles

| Scenario | Status | Test |
|---|---|---|
| UnpackOneAttachment | covered | `server/test/mailAttachments.test.ts` › unpackAttachments › "unpacks one attachment by its identifier"; through the tool, with the deck's bytes absent from the answer, in `server/test/mailTool.test.ts` › "unpacks the attachments it is asked for and names their paths" |
| UnpackEveryAttachment | covered | `server/test/mailAttachments.test.ts` › "writes the attachments beside the message, byte for byte" |
| UnpackedFileIsByteIdentical | covered | same test (`readFile(...).equals(deck)`), and `server/test/mailTool.test.ts` › "unpacks the attachments it is asked for and names their paths" |
| TwoMessagesDoNotCollide | covered | `server/test/mailAttachments.test.ts` › "two messages carrying the same name do not collide" |
| TraversingAttachmentNameIsContained | covered | `server/test/mailAttachments.test.ts` › safeAttachmentName › "contains a traversing name inside one component" and unpackAttachments › "reports the written name beside the claimed one when they differ" (asserts nothing outside the directory); end to end in `server/test/mailTool.test.ts` › "unpacks an Outlook attachment under a name derived from a hostile one" |
| WrittenNameIsReportedWhenItDiffers | covered | `server/test/mailAttachments.test.ts` › "reports the written name beside the claimed one when they differ"; the wording in `server/test/mailTool.test.ts` › "unpacks an Outlook attachment under a name derived from a hostile one" |
| AttachmentWithNoName | covered | `server/test/mailAttachments.test.ts` › "writes a nameless attachment under a name derived from its identifier and type" |
| DestinationExists | covered | `server/test/mailAttachments.test.ts` › "leaves an existing file untouched and names it" |
| WritesDisabled | covered | `server/test/mailAttachments.test.ts` › "refuses to write anything when the sandbox is read-only" (asserts no directory was created); reading unaffected in `server/test/mailTool.test.ts` › "refuses to write in a read-only sandbox, and still reads" |

Also covered here: a destination escaping the writable zone — `server/test/mailAttachments.test.ts` ›
"refuses a destination outside the writable zone"; two identically named attachments inside one
message — "two attachments named alike inside one message both land"; an attachment with no content
— "lists an attachment with no content as unwritten, with the reason".

### Requirement: MessageIsUntrustedContent

| Scenario | Status | Test |
|---|---|---|
| ResultMarksTheMessageUntrusted | covered | `server/test/mailTool.test.ts` › "says the message is untrusted before any of its own words" (asserts the warning's index precedes both the headers and the body) |
| RemoteImagesAreNotFetched | covered | `server/test/mailHtml.test.ts` › "reports an image reference instead of resolving it, and never fetches" (replaces `globalThis.fetch` with a spy that throws, and asserts it was never called) |
| BodyScriptIsNeverRun | covered | `server/test/mailHtml.test.ts` › "drops scripts, styles and head without dropping the body"; the scanner's handling of a script's `<` in `server/test/mailHtml.test.ts` › scanHtml › "reads a script's content as text rather than as markup" |
| SenderIsNotPresentedAsVerified | covered | `server/test/mailTool.test.ts` › "says the message is untrusted before any of its own words" (asserts the "Nothing here authenticates the sender" line) |

### Requirement: BoundedMailExtraction

| Scenario | Status | Test |
|---|---|---|
| LongBodyTruncated | covered | `server/test/mailTool.test.ts` › "truncates a long body, says so, and never truncates the inventory" (asserts the count and the `full: true` advice) |
| InventorySurvivesTruncation | covered | `server/test/mailTool.test.ts` › "keeps the inventory when the body is truncated" (the attachment sits after 30 000 characters of body) |
| WholeMessageInOneCall | covered | `server/test/mailTool.test.ts` › "truncates a long body, says so, and never truncates the inventory" (the `full: true` half: no truncation note, longer answer) |
| WriteWholeExtractionToFile | covered | `server/test/mailTool.test.ts` › "writes the whole extraction to a file and returns a summary instead of the content" |
| DestinationOutsideWritableZone | covered | `server/test/mailTool.test.ts` › "refuses a destination outside the writable zone"; the existing-file refusal in "refuses a destination that already exists, and reading still works" |
| ParsingExceedsBudget | covered | `server/test/mail.test.ts` › "gives up inside the time budget rather than hanging" (`MailError` with reason `budget`); the per-event deadline in `server/test/mailHtml.test.ts` › "the deadline can abandon a body" |

### Requirement: MailSizeLimit

| Scenario | Status | Test |
|---|---|---|
| MessageWithinTheLimit | covered | `server/test/mailTool.test.ts` › "the configured limit decides, and names itself when it refuses" (the generous tool reads it) |
| MessageOverTheLimit | covered | same test (the mean tool refuses on the file's size, before any parse) |
| ConfiguredLimitIsHonoured | covered | same test, plus `server/test/config.test.ts` › "mail.maxBytes defaults to 25 MB and can be changed" and "the mail limit leaves every other file's limit alone" |

### Requirement: MessagesThisSystemWillNotRead

| Scenario | Status | Test |
|---|---|---|
| EncryptedMessage | covered | `server/test/mail.test.ts` › "refuses an S/MIME encrypted message as encrypted" and "refuses a PGP message as encrypted"; through the tool in `server/test/mailTool.test.ts` › "reports an encrypted message as encrypted" |
| SignedMessage | covered | `server/test/mail.test.ts` › "reads a signed message from the content the signature covers" (body present, note says unverified, signature part not offered as a document); the opaque case in "says an opaque signature hides the content, rather than reporting an empty body" |
| MalformedMessageYieldsWhatItCan | covered | `server/test/mail.test.ts` › "yields what it can from a truncated multipart, and names what failed"; the container equivalents in `server/test/mailMsg.test.ts` › "terminates on a file whose allocation table points in a circle" and "refuses a file too short to be a compound file" |

## specs/composer-file-upload/spec.md (MODIFIED)

The requirement is modified, so its pre-existing scenarios are listed with the tests that already
hold them — a modified requirement is only as covered as its whole contract.

| Scenario | Status | Test |
|---|---|---|
| Dropped PDF becomes a path reference | covered | `ui/src/attachments.test.ts` › filesToAttachments › "uploads a PDF and attaches the written path instead of its bytes"; at the composer in `ui/src/App.test.tsx` › "copies a dropped PDF into the workspace and references the path it wrote" |
| Attach button and drop behave alike | covered | `ui/src/App.test.tsx` › "produces the same attachment from the attach button as from a drop" |
| Dropped Outlook message becomes a path reference | covered | `ui/src/attachments.test.ts` › "uploads a dropped .msg instead of refusing it as an unsupported binary"; classification in "routes an email to an upload whatever its size, so its MIME never reaches the prompt" |
| Small dropped .eml is referenced, not inlined | covered | `ui/src/attachments.test.ts` › "uploads a dropped .eml and attaches the path, not its MIME source" (asserts the prompt carries `@uploads/Dossier.eml` and neither `boundary` nor the base64) |
| Image within the limit is shown to the model without a copy | covered | `ui/src/attachments.test.ts` › "attaches an image within the limit as bytes, with no copy in the workspace" |
| Image within the limit survives a workspace that cannot be written | covered | `ui/src/attachments.test.ts` › "attaches an image's bytes even in a workspace that cannot be written" |
| Oversized image is referenced instead of refused | covered | `ui/src/attachments.test.ts` › "references an oversized image by path rather than refusing it" |
| Small text file is still inlined | covered | `ui/src/attachments.test.ts` › "converts text files to text attachments" (asserts the upload was never called) |
| Large text file is referenced instead of refused | covered | `ui/src/attachments.test.ts` › "references text too large to inline instead of refusing it" |
| Unsupported binary names its own reason | covered | `ui/src/attachments.test.ts` › "names an unsupported binary's own type instead of the text limit" |

Also covered: `needsUpload` agreeing with the classification, so the pending chip is shown for
exactly the files that reach the server — `ui/src/attachments.test.ts` › "agrees with needsUpload, so
the pending chip is shown for exactly these files".

## specs/agent/spec.md (MODIFIED)

| Scenario | Status | Test |
|---|---|---|
| A code session publishes no extractor | covered | `server/test/documentToolsWire.test.mjs` › "a document extractor is published when a document is named, and not before" (the `hello` snapshot assertions) |
| Naming a document publishes its extractor, before the turn | covered | same wire test (request 1 carries `docx_extract` and no other extractor) |
| An attached document publishes its extractor | covered | `server/test/documentTools.test.ts` › documentToolsFor › "a mention is matched wherever a path can appear" (the `@path` form the composer appends) |
| Naming an email publishes the mail extractor | covered | `server/test/documentTools.test.ts` › mail tools › "a named message publishes the mail extractor and nothing else"; over the wire in `server/test/mailToolsWire.test.mjs` (request 0) |
| An unpacked attachment publishes its extractor within the turn | covered | `server/test/mailToolsWire.test.mjs` › "unpacking an attachment publishes its extractor inside the turn" (request 1 of the same turn carries `pptx_extract` and `pdf_extract`) |
| Only the kinds actually written are published | covered | `server/test/mailToolsWire.test.mjs` (asserts `xlsx_extract` absent); unit form in `server/test/documentTools.test.ts` › "only the kinds actually written"; and `server/test/mailTool.test.ts` › "publishes nothing for an attachment no extractor reads" |
| A path the agent merely names publishes nothing | covered | `server/test/documentTools.test.ts` › mail tools › "a path the agent merely names publishes nothing" (`ls` on a `.xlsx`, `read` on a `.pdf`, `find` on a `.msg`) |
| A tool published on a wrong guess is withdrawn when the turn ends | covered | `server/test/documentToolsWire.test.mjs` (request 2 carries none of them); for a tool published by a *write*, `server/test/mailToolsWire.test.mjs` (the deck's and report's extractors are gone on the next turn) |
| A tool that was used survives the quiet turns around its work | covered | `server/test/documentToolsWire.test.mjs` (four further turns); `server/test/mailToolsWire.test.mjs` asserts the same for `mail_extract`, which was called |
| A tool nobody has wanted for five turns is forgotten | covered | `server/test/documentToolsWire.test.mjs` ("five idle turns after its last call") |
| Naming the document again brings its extractor back | covered | `server/test/documentToolsWire.test.mjs` (the republish assertion at the end) |
| A workspace holding documents publishes nothing by itself | covered | `server/test/documentToolsWire.test.mjs` (the workspace holds `report.docx` that nothing has named); for a message, `server/test/mailToolsWire.test.mjs` (`mail_extract` withheld although `uploads/dossier.msg` is present) |
| The word is not the path | covered | `server/test/documentTools.test.ts` › "the word is not the path"; for mail, "talking about email publishes nothing" |
| A runtime that cannot gate publishes them all | covered | `server/test/piOutpostTools.test.ts` › createPiOutpostTools › "returns the tools the agent needs, in the documented order" (the RPC child's list, `mail_extract` included) and "registers the same tools when the env var is set" |

## Not claimed as test coverage

- The **running-app passes** (tasks 9.1 and 9.2) exercise the drop, the extraction and the unpacking
  in the real app with Playwright. They are evidence for the same scenarios rather than a second
  source of truth, and they are reported in the pull request, not here.
- `Bienvenue.msg`, the real Outlook message used to check the reader by hand, is **not** committed:
  it is personal mail. The committed fixture `server/test/fixtures/mail-outlook.msg` is built by
  `server/scripts/build-mail-fixtures.mts` and covers the same paths.
