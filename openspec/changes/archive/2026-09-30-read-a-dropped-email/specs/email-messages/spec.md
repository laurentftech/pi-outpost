## Purpose

Makes an email dropped into the workspace readable by the agent: an Outlook `.msg`, a macOS Mail or
webmail `.eml`, or Apple Mail's `.emlx` becomes its headers, its body as markdown and an inventory of
its attachments — and those attachments become ordinary workspace files, so the document extractors
already in this system read the deck, the contract or the report the mail was sent to carry.

## ADDED Requirements

### Requirement: ReadAnEmailAtAPath

The system SHALL expose a tool that returns the content of an email message held at a workspace path
as markdown. It SHALL accept `.eml` and `.emlx` (internet message format) and `.msg` (Outlook's
compound-file message), deciding which to read from the file's own bytes rather than from its
extension — a message saved under the wrong extension SHALL be read, not refused.

The result SHALL carry, before the body: the subject, the sender, the recipients of the `To` and `Cc`
fields, and the date the message was sent. A header the message does not carry SHALL be reported as
absent rather than rendered as an empty value. `Bcc` SHALL be returned when the file holds it, since
a sent-items copy does.

The tool SHALL be subject to the same path confinement as the other read tools: a path resolving —
symlinks included — outside the sandbox root SHALL be refused with an access-denied error and no file
SHALL be read.

#### Scenario: ReadAnEmlMessage
- **WHEN** the tool is called on a `.eml` file
- **THEN** it returns the subject, sender, recipients and date, followed by the message body

#### Scenario: ReadAnOutlookMsgMessage
- **WHEN** the tool is called on a `.msg` file saved from Outlook
- **THEN** it returns the same fields and body as it would for the equivalent `.eml`

#### Scenario: ReadAnEmlxMessage
- **WHEN** the tool is called on an `.emlx` file from Apple Mail's store
- **THEN** the leading byte count and the trailing property list are not part of the result, and the message reads as a `.eml` would

#### Scenario: ExtensionDoesNotDecideTheFormat
- **GIVEN** an Outlook message saved with a `.eml` extension
- **WHEN** the tool is called on it
- **THEN** it is read as the compound-file message it is, rather than refused as malformed MIME

#### Scenario: AbsentHeaderIsNamedAbsent
- **GIVEN** a message with no `Cc` recipients
- **WHEN** it is extracted
- **THEN** the result says so, rather than showing an empty `Cc` line

#### Scenario: PathOutsideSandbox
- **WHEN** the tool is called with a path that resolves outside the sandbox root
- **THEN** the call is refused with an access-denied error and no file is read

#### Scenario: NotAMessage
- **WHEN** the tool is called on a file that is neither an internet message nor a compound-file message
- **THEN** it returns an error naming that reason, not an empty result

### Requirement: MessageBodyAsMarkdown

The system SHALL return one body for a message, chosen from the forms the message holds, and SHALL
say which form it read — the same text reads differently as HTML and as plain text, and a reader
quoting it needs to know which it has.

A plain-text body SHALL be returned as it stands. An HTML body SHALL be reduced to markdown:
headings, paragraphs, lists, tables, emphasis and link targets SHALL survive; styling, layout tables
used only for layout, scripts, stylesheets and tracking markup SHALL NOT appear in the result. A
`multipart/alternative` message SHALL be read from whichever part carries the content, preferring the
plain-text part when it is not a degraded stub of the HTML one.

An Outlook message whose only body is compressed rich text SHALL be decompressed. Where that rich
text encapsulates HTML — which is how Outlook stores an HTML message — the HTML SHALL be recovered
and reduced as any other HTML body. Where it is genuine rich text, its text SHALL be returned with
its markup removed, best-effort, and the result SHALL say that the body was read from rich text.

A message whose body cannot be read SHALL say so and name the forms it holds. An empty result MUST
NOT stand in for a body that exists and was not understood.

The quoted history below a reply SHALL be returned, not discarded: which part of a thread matters is
the reader's judgement, not this system's. Where the message marks the boundary, the result SHALL
mark it too.

#### Scenario: PlainTextBody
- **WHEN** a message carrying only a plain-text body is extracted
- **THEN** its text is returned unchanged, and the result names plain text as the form read

#### Scenario: HtmlBodyBecomesMarkdown
- **WHEN** a message with an HTML body is extracted
- **THEN** its headings, lists, tables and links are returned as markdown, and no script, style or layout markup appears

#### Scenario: MultipartAlternativePrefersTheRealContent
- **GIVEN** a `multipart/alternative` message whose plain-text part is a one-line "view this in HTML" stub
- **WHEN** it is extracted
- **THEN** the HTML part is the one read

#### Scenario: CompressedRichTextWrappingHtml
- **GIVEN** an Outlook message whose only body is compressed rich text encapsulating HTML
- **WHEN** it is extracted
- **THEN** the HTML is recovered and returned as markdown

#### Scenario: GenuineRichTextBody
- **GIVEN** an Outlook message whose only body is genuine rich text
- **WHEN** it is extracted
- **THEN** its text is returned without rich-text markup, and the result says the body was read from rich text

#### Scenario: UnreadableBodyIsNotAnEmptyBody
- **GIVEN** a message whose body is in a form this system does not understand
- **WHEN** it is extracted
- **THEN** the result says the body could not be read and names the forms the message holds

#### Scenario: QuotedHistoryIsKept
- **GIVEN** a reply quoting the message it answers
- **WHEN** it is extracted
- **THEN** the quoted history is present in the result, marked as quoted where the message marks it

### Requirement: HeadersAndBodyAreDecoded

A message states its own encoding and this system SHALL honour it. Headers encoded per RFC 2047
(`=?UTF-8?B?…?=`, `=?ISO-8859-1?Q?…?=`) SHALL be decoded to text, including a subject split across
several encoded words and a display name encoded separately from its address. Bodies and attachment
names SHALL be decoded from their stated transfer encoding — `base64`, `quoted-printable` — and from
their stated character set, `UTF-8`, `ISO-8859-1` and `windows-1252` included. An Outlook message's
properties SHALL be decoded according to whether the property is stored as Unicode or in the
message's code page.

An accented subject, sender name or file name SHALL come back with its accents. An unknown or absent
character set SHALL fall back to a documented default rather than failing the extraction, and the
result SHALL say when it did.

#### Scenario: EncodedWordSubject
- **GIVEN** a message whose subject is an RFC 2047 encoded word carrying accented characters
- **WHEN** it is extracted
- **THEN** the subject is returned as readable text with its accents intact

#### Scenario: SubjectSplitAcrossEncodedWords
- **GIVEN** a long subject split into several encoded words
- **WHEN** it is extracted
- **THEN** it is returned as one subject line, joined without the encoding's separators

#### Scenario: QuotedPrintableLatin1Body
- **GIVEN** a `quoted-printable` body declared as `ISO-8859-1`
- **WHEN** it is extracted
- **THEN** its text is returned decoded, with no `=E9`-style escapes and no replacement characters

#### Scenario: NonUnicodeOutlookProperties
- **GIVEN** an Outlook message whose properties are stored in a single-byte code page
- **WHEN** it is extracted
- **THEN** its subject and sender are decoded with that code page rather than read as raw bytes

#### Scenario: UnknownCharacterSet
- **GIVEN** a part declaring a character set this system does not know
- **WHEN** it is extracted
- **THEN** the extraction succeeds using the documented fallback and says which part it fell back for

### Requirement: AttachmentInventory

The system SHALL list a message's attachments as part of the extraction, whether or not any of them
is unpacked. Each entry SHALL carry a stable identifier to ask for it by, its file name, its media
type and its size. The identifier SHALL remain the same across repeated extractions of the same
file, so a caller can name one after reading the inventory.

The inventory SHALL distinguish a real attachment from an image the body references inline, and SHALL
say which body reference an inline image belongs to. An attached message — a forwarded mail — SHALL be
listed as such, naming its subject, and SHALL be unpackable like any other attachment.

A message with no attachments SHALL say so. An attachment whose content cannot be read SHALL be
listed with the reason instead of being omitted: a caller must not conclude from the inventory that a
file the message carries does not exist.

#### Scenario: InventoryNamesEachAttachment
- **GIVEN** a message carrying a `.pptx`, a `.pdf` and a `.txt`
- **WHEN** it is extracted
- **THEN** all three are listed with an identifier, a name, a media type and a size

#### Scenario: InlineImagesAreDistinguished
- **GIVEN** an HTML message whose body embeds a signature logo
- **WHEN** it is extracted
- **THEN** the logo is listed as an inline image, tied to the body reference that uses it, and not as a document attachment

#### Scenario: ForwardedMessageIsAnAttachment
- **GIVEN** a message carrying another message as an attachment
- **WHEN** it is extracted
- **THEN** that message is listed with its subject and can be unpacked

#### Scenario: NoAttachments
- **WHEN** a message with no attachments is extracted
- **THEN** the result says it carries none

#### Scenario: UnreadableAttachmentIsStillListed
- **GIVEN** a message with an attachment whose content is truncated or malformed
- **WHEN** it is extracted
- **THEN** it appears in the inventory with the reason it could not be read

### Requirement: UnpackAttachmentsIntoWorkspaceFiles

The system SHALL unpack a message's attachments into workspace files on request — by identifier, or
all of them — and SHALL return the path it wrote each one to. It MUST NOT return an attachment's
content in the extraction itself: what makes an emailed deck readable is that `pptx_extract` can open
it at a path, and returning the bytes as well would spend the context on a document nobody has asked
about yet.

Unpacked files SHALL be written into a directory derived from the message's own path, so the
attachments of two messages cannot collide and a caller can see which message a file came from.

A file name from an email is hostile input. The name written SHALL be derived from the attachment's
name but SHALL be a single path component, with any directory separator, traversal segment, control
character or reserved device name removed — an attachment named `../../.ssh/authorized_keys` SHALL NOT
escape the directory it is unpacked into, and the extension the model needs in order to choose a
reader SHALL be preserved. An attachment with no usable name SHALL be given one derived from its
identifier and media type. The result SHALL show the name written next to the name the message
claimed whenever the two differ.

An existing file SHALL NOT be overwritten: the write SHALL be refused, naming the path, as extraction
to a file already is.

Unpacking is a write and SHALL be governed by the same permission as any other write from this
system. It SHALL be refused when writing is disabled, and refused when the resolved destination —
symlinks included — falls outside the writable zone. Refusing it MUST NOT prevent the same call from
returning the message's headers, body and inventory: reading a mail never depended on being able to
write.

What is written SHALL be byte-identical to the attachment the message carries, so the document
extractors see the file the sender sent.

#### Scenario: UnpackOneAttachment
- **GIVEN** a message carrying a `.pptx`
- **WHEN** unpacking is requested for that attachment
- **THEN** it is written into the message's attachment directory, the result names the path, and the deck's content is not part of the result

#### Scenario: UnpackEveryAttachment
- **WHEN** unpacking is requested for all of a message's attachments
- **THEN** each is written and each path is named

#### Scenario: UnpackedFileIsByteIdentical
- **WHEN** an attachment is unpacked
- **THEN** the written file's bytes are exactly the attachment's bytes

#### Scenario: TwoMessagesDoNotCollide
- **GIVEN** two messages in the workspace each carrying an attachment named `report.pdf`
- **WHEN** both are unpacked
- **THEN** each is written under its own message's directory and neither overwrites the other

#### Scenario: TraversingAttachmentNameIsContained
- **GIVEN** an attachment whose name contains directory separators or `..` segments
- **WHEN** it is unpacked
- **THEN** it is written as a single file inside the attachment directory, its extension preserved, and nothing is written outside that directory

#### Scenario: WrittenNameIsReportedWhenItDiffers
- **WHEN** the name written differs from the name the message claimed
- **THEN** the result shows both

#### Scenario: AttachmentWithNoName
- **GIVEN** an attachment carrying no file name
- **WHEN** it is unpacked
- **THEN** it is written under a name derived from its identifier and media type

#### Scenario: DestinationExists
- **GIVEN** a file already at the path an attachment would be written to
- **WHEN** unpacking is requested
- **THEN** it is refused, the existing file is untouched, and the message names the path

#### Scenario: WritesDisabled
- **GIVEN** a sandbox where writing is not allowed
- **WHEN** unpacking is requested
- **THEN** it is refused as denied, no file is created anywhere, and the message's headers, body and inventory are still returned

### Requirement: MessageIsUntrustedContent

An email is content from outside the system, written by someone who is not the user and who may
intend the agent to act on it. The extraction SHALL therefore present the message as data: the result
SHALL state, before the body, that the headers, body and attachment names are untrusted third-party
content and that instructions found inside them are not the user's.

Reading a message MUST NOT fetch anything over the network — no remote image, no linked stylesheet,
no external entity — and MUST NOT execute script or macro content it contains, in the body or in an
attachment. A `cid:`, `http:` or `file:` reference in the body SHALL be reported as the reference it
is, never followed.

A sender address SHALL be returned as the message states it, and the result MUST NOT present it as
verified: nothing here authenticates a header.

#### Scenario: ResultMarksTheMessageUntrusted
- **WHEN** any message is extracted
- **THEN** the result says, before the body, that its content is untrusted third-party data

#### Scenario: RemoteImagesAreNotFetched
- **GIVEN** an HTML body referencing an image on a remote host
- **WHEN** it is extracted
- **THEN** no network request is made, and the reference is reported rather than resolved

#### Scenario: BodyScriptIsNeverRun
- **GIVEN** an HTML body containing a script
- **WHEN** it is extracted
- **THEN** the script is absent from the result and nothing from it is executed

#### Scenario: SenderIsNotPresentedAsVerified
- **WHEN** a message is extracted
- **THEN** the sender is reported as the address the message states, with no claim that it was authenticated

### Requirement: BoundedMailExtraction

One extraction call SHALL be bounded, so a long thread or a message with a large body cannot flood
the agent's context. The body returned SHALL be capped per call; when the cap truncates it, the
result SHALL say so and state how to obtain the rest. The attachment inventory SHALL never be
truncated — it is the map to everything else the message holds, and a cap that hid an entry would
hide a file.

The tool SHALL offer whole-message extraction in one call, past the per-call cap, and SHALL accept a
destination path that writes the whole extraction to a workspace file and returns a summary — the
path written, how much it covers and an opening excerpt — instead of the content. A destination SHALL
be governed by the same write permission and confinement as unpacking, and an existing path SHALL be
refused rather than overwritten.

A message that cannot be parsed within a time budget SHALL fail with a message saying so, rather than
hanging the session.

#### Scenario: LongBodyTruncated
- **GIVEN** a message whose body far exceeds the per-call cap
- **WHEN** it is extracted without asking for the whole message
- **THEN** the body is truncated, the result says so, and it states how to get the rest

#### Scenario: InventorySurvivesTruncation
- **GIVEN** a message whose body is truncated by the cap
- **WHEN** it is extracted
- **THEN** every attachment is still listed

#### Scenario: WholeMessageInOneCall
- **WHEN** whole-message extraction is requested for a message past the per-call cap
- **THEN** the whole body is returned in that one call, with no truncation note

#### Scenario: WriteWholeExtractionToFile
- **GIVEN** a destination inside the writable zone
- **WHEN** extraction is requested with it
- **THEN** the whole extraction is written there and the call returns the path, the coverage and an excerpt rather than the content

#### Scenario: DestinationOutsideWritableZone
- **WHEN** the destination resolves outside the writable zone, by traversal or through a symlink
- **THEN** it is refused as denied and nothing is written

#### Scenario: ParsingExceedsBudget
- **WHEN** a message cannot be parsed within the time budget
- **THEN** the call fails with a message naming that reason and the session stays responsive

### Requirement: MailSizeLimit

The system SHALL apply a mail-specific size limit, configurable, defaulting to 25 MiB — a message
carrying a deck routinely exceeds the limit that governs ordinary file reads. A message over the
limit SHALL be refused with a message naming the limit, before it is parsed, rather than partially
read. The limit for every other kind of file SHALL be unchanged.

The limit SHALL govern the message file. An attachment inside it SHALL additionally be subject to the
limit of its own kind when a document extractor later opens it, exactly as a file of that kind in the
workspace is.

#### Scenario: MessageWithinTheLimit
- **GIVEN** a 12 MiB message and a 25 MiB mail limit
- **WHEN** it is extracted
- **THEN** it is read

#### Scenario: MessageOverTheLimit
- **GIVEN** a message larger than the configured mail limit
- **WHEN** extraction is requested
- **THEN** it is refused, the message names the limit, and the file is not parsed

#### Scenario: ConfiguredLimitIsHonoured
- **GIVEN** a configuration setting a mail limit other than the default
- **WHEN** a message between the default and the configured limit is extracted
- **THEN** the configured limit decides the outcome

### Requirement: MessagesThisSystemWillNotRead

The system SHALL distinguish a message it cannot read from one it will not, and SHALL name the reason
in either case. An encrypted message — S/MIME or PGP — SHALL be refused as encrypted, naming that
this system holds no key, rather than returning its ciphertext as a body. A signed message SHALL be
read from the content the signature covers, and the result SHALL say that a signature is present and
was not verified. A truncated or malformed message SHALL be read as far as it parses, returning what
it yielded and naming what failed.

#### Scenario: EncryptedMessage
- **WHEN** the tool is called on an encrypted message
- **THEN** it reports that the message is encrypted and that no key is held, and returns no ciphertext as a body

#### Scenario: SignedMessage
- **WHEN** the tool is called on a signed message
- **THEN** the signed content is returned as the body, and the result says a signature is present and unverified

#### Scenario: MalformedMessageYieldsWhatItCan
- **GIVEN** a message whose structure is truncated partway through
- **WHEN** it is extracted
- **THEN** the headers and parts that parsed are returned, and the result names what could not be read
