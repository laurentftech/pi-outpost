# Spec Delta

## Purpose

Lets a reader take a whole conversation away as one self-contained HTML document, so an exchange can
be archived or sent to someone who does not run this application and will still be able to read it
years later, with its diagrams, images and tool calls intact.

## ADDED Requirements

### Requirement: ExportTheWholeConversationAsHTML

The system SHALL offer an action that produces the conversation currently being watched as a single
HTML document and hands it to the browser as a download.

The document SHALL contain every item of the conversation's active branch, from its first message to
its last — including the items compaction removed from the model's context, whether or not the
reader has loaded them on screen. The export SHALL obtain what is missing itself rather than
exporting what happens to be loaded.

What the reader has hidden or collapsed on screen SHALL NOT change what the document contains: a
conversation filter, a collapsed tool card and an unexpanded figure are view state, and the archive
is of the conversation.

Nothing SHALL be written into the workspace: the export is a download, and the workspace is unchanged
by it. Exporting SHALL NOT alter the conversation — no message sent, no item removed, no draft
changed, no session switched.

The downloaded file SHALL be named after the session and carry the `.html` extension, so that
several exports of different conversations do not collide in a downloads folder.

#### Scenario: DownloadsTheWholeConversation
- **GIVEN** a compacted conversation whose transcript on screen begins after the compaction point
- **WHEN** the export action is invoked
- **THEN** the browser is handed one `.html` file containing every message from the conversation's first to its last, and no workspace file is created

#### Scenario: ViewStateDoesNotNarrowTheExport
- **GIVEN** a conversation with tools hidden by a filter and every tool card collapsed
- **WHEN** it is exported
- **THEN** the document contains the tool calls

#### Scenario: NamedAfterTheSession
- **GIVEN** a session with a name
- **WHEN** it is exported
- **THEN** the downloaded file's name identifies that session and ends in `.html`

#### Scenario: ConversationLeftAlone
- **GIVEN** a conversation with a draft in the composer
- **WHEN** it is exported
- **THEN** no message is sent, the transcript is as it was, and the draft is unchanged

### Requirement: TheDocumentIsSelfContained

The exported document SHALL be readable from a filesystem with no network, no application and no
JavaScript: opened in a browser with scripting disabled and no connectivity, it SHALL show the whole
conversation, its images, its diagrams and its equations.

It SHALL therefore reference no external file: workspace images the conversation displays SHALL
travel inside the document, diagrams SHALL travel as vector graphics inside it, and equations SHALL
render without an attached stylesheet or font file.

Tool calls SHALL be present and SHALL start folded, expandable by the reader through a native
mechanism that needs no script. The document SHALL be legible in both a light and a dark reading
environment.

Producing the document SHALL NOT reach beyond the origin that served the application: no font,
script, style or theme SHALL be fetched to produce it, and no part of the conversation SHALL be sent
anywhere.

#### Scenario: ReadableOfflineWithoutScript
- **GIVEN** an exported document containing text, a workspace image, a diagram and an equation
- **WHEN** it is opened from disk with no network connection and JavaScript disabled
- **THEN** the conversation, the image, the diagram and the equation are all shown

#### Scenario: NoExternalReferences
- **WHEN** a conversation is exported
- **THEN** the document references no file, stylesheet, font or script outside itself

#### Scenario: ToolCallsFoldWithoutScript
- **GIVEN** an exported document containing a tool call, opened with JavaScript disabled
- **WHEN** the reader expands the tool call
- **THEN** its input and output are shown, and it was folded before

#### Scenario: ExportIsOffline
- **WHEN** a conversation is exported
- **THEN** every request the export makes stays on the application's own origin, and nothing is sent off it

#### Scenario: ReadableInBothThemes
- **WHEN** the exported document is opened by a reader whose system asks for a dark colour scheme, and by one asking for light
- **THEN** the conversation is legible in both

### Requirement: TheDocumentCarriesNoActiveContent

A conversation is untrusted text whoever produced it: a model can write markup, and so can a tool
result quoting a web page. The exported document SHALL be filtered with the same allow-list the
conversation itself is rendered through, so that markup which cannot run in the application cannot
run in the archive either.

The document SHALL contain no script, no inline event handler, no `javascript:` URL, no framing
element, and no form. A reference to an external resource SHALL NOT be introduced by the
conversation's own content: content that names a remote image, font or stylesheet SHALL NOT cause the
opened archive to fetch it.

Content the conversation displays SHALL NOT be able to escape into the document's own structure:
markup in a message MUST NOT be able to close an element the document opened, inject an attribute, or
alter the document outside the message it belongs to.

#### Scenario: ScriptIsFiltered
- **GIVEN** a conversation containing a script element, an inline event handler and a `javascript:` link in a reply
- **WHEN** it is exported
- **THEN** none of them is present in the document

#### Scenario: RemoteReferencesDoNotSurvive
- **GIVEN** a reply naming a remote image and a remote stylesheet
- **WHEN** the document is opened offline
- **THEN** it fetches nothing, and does not depend on either

#### Scenario: MarkupCannotEscapeItsMessage
- **GIVEN** a message whose text closes elements it never opened and injects attributes
- **WHEN** the document is exported and opened
- **THEN** the document's structure is intact and the message's content is confined to that message

#### Scenario: NoFormsOrFrames
- **GIVEN** a conversation containing a form and an iframe in its text
- **WHEN** it is exported
- **THEN** neither is present in the document

### Requirement: TheDocumentSaysWhatItIs

The document SHALL open with a header identifying the conversation it holds: the project it ran in,
the session's name, when it took place, and the model or models that answered. A reader who receives
the file without context SHALL be able to tell what it is from the document alone.

Each message SHALL be attributed to its author — the person or the agent — in reading order, so the
exchange can be followed without the application's colours and layout.

#### Scenario: HeaderIdentifiesTheConversation
- **WHEN** an exported document is opened
- **THEN** its header names the project, the session, the date of the conversation, and the model that answered

#### Scenario: AuthorshipIsLegible
- **GIVEN** an exported conversation alternating between the user and the agent
- **WHEN** it is read
- **THEN** each message says who wrote it, in the order they were exchanged

### Requirement: TheExportIsBoundedAndRefusesRatherThanTruncates

The export SHALL either produce the whole conversation or produce nothing. If part of the history
cannot be obtained — the runtime cannot supply it, or a request fails — the export SHALL report what
is missing and SHALL NOT hand over a document, because a partial archive cannot be told from a
complete one once it has been sent.

The content the document embeds SHALL be bounded, so that one conversation cannot produce an
unopenable file: past its budget the export SHALL stop and SHALL name what exceeded it, rather than
silently dropping content from the document.

A diagram that cannot be drawn SHALL leave its source text in the document rather than a gap, and
SHALL NOT fail the export.

While the export is being produced the interface SHALL show that it is under way, and the action
SHALL NOT be offered where it has no meaning — a conversation with no messages.

#### Scenario: MissingHistoryRefusesTheExport
- **GIVEN** a deployment whose runtime cannot supply the conversation's older items
- **WHEN** the export action is invoked
- **THEN** the export reports that the conversation cannot be exported in full, and no file is downloaded

#### Scenario: FailedChunkRefusesTheExport
- **GIVEN** an export in progress whose request for older items fails
- **WHEN** the failure arrives
- **THEN** no file is downloaded and the failure is reported

#### Scenario: BudgetIsNamedNotSilent
- **GIVEN** a conversation whose embedded images exceed the export's budget
- **WHEN** it is exported
- **THEN** the export stops and reports what exceeded the budget, and does not hand over a document with images missing

#### Scenario: UndrawableDiagramKeepsItsSource
- **GIVEN** a conversation containing a diagram whose source cannot be drawn
- **WHEN** it is exported
- **THEN** the document carries that diagram's source text and the rest of the conversation is exported

#### Scenario: ProgressIsVisible
- **GIVEN** a long conversation with several diagrams
- **WHEN** the export is invoked
- **THEN** the interface shows that an export is under way until the file is handed over

#### Scenario: NotOfferedForAnEmptyConversation
- **GIVEN** a session with no messages
- **WHEN** the reader looks for the export action
- **THEN** it is not offered
