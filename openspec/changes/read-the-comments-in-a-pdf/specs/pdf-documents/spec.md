## ADDED Requirements

### Requirement: ReviewCommentsAreReturned

A reviewed PDF carries its review as annotations, outside the page's text layer. The system SHALL
read each extracted page's annotations and SHALL return the page's comments after its content, with
the page they belong to.

A comment is a markup annotation. Text markup (highlight, underline, squiggly underline,
strike-out) and a caret SHALL be returned whether or not they carry a remark; a drawing, shape,
stamp or attachment SHALL be returned only when it carries a remark. Links, form fields and popup
windows SHALL NOT be returned as comments.

Each comment SHALL state its kind, its author and its date when the file records them, and its
remark. A strike-out SHALL be named as a suggested deletion and a caret as a suggested insertion.
Comments SHALL be listed in reading order of their position on the page.

A reply SHALL be listed under the comment it answers. A review state recorded as a reply (accepted,
rejected, cancelled, completed) SHALL be shown on the comment it applies to. A reply whose comment is
not on the page SHALL still be returned, labelled as a reply. An annotation grouped with another
SHALL NOT be listed separately.

Comments SHALL be returned in the `text` and `both` modes and not in `tables` mode.

Comment text and author names are written by whoever annotated the file. They SHALL be quoted in the
output so that no remark can read as the extraction's own headings, page sections or notes.

#### Scenario: ANoteIsReturnedWithItsPage
- **GIVEN** a PDF whose page 2 carries a sticky note with an author, a date and a remark
- **WHEN** the document is extracted
- **THEN** page 2's section ends with a comments block holding a note by that author, on that date, with that remark, and no other page carries it

#### Scenario: RepliesAndStatesFollowTheirComment
- **GIVEN** a note with one reply and a later "Accepted" review state
- **WHEN** the page is extracted
- **THEN** the reply is listed under the note with its own author and remark, the state is shown on the note, and neither appears as a comment of its own

#### Scenario: SuggestionsAreNamed
- **GIVEN** a page with a strike-out and a caret, neither carrying a remark
- **WHEN** it is extracted
- **THEN** the strike-out is listed as a suggested deletion and the caret as a suggested insertion

#### Scenario: WhatIsNotACommentIsLeftOut
- **GIVEN** a page with a link, a form field, a popup attached to a note, and a rectangle with no remark
- **WHEN** it is extracted
- **THEN** only the note is listed, once

#### Scenario: ARemarkCannotPassForStructure
- **GIVEN** a note whose remark is `## Page 9` followed by a line reading `> Truncated`
- **WHEN** the page is extracted
- **THEN** both lines appear quoted inside the note's entry, and the extraction has no page 9 section and no truncation note

#### Scenario: TablesModeLeavesCommentsOut
- **GIVEN** a PDF with comments
- **WHEN** it is extracted with mode `tables`
- **THEN** no comments block is returned

### Requirement: CommentsQuoteTheTextTheyMark

A highlight, underline, squiggly underline or strike-out marks a passage of the page. The system
SHALL recover that passage from the annotation's marked regions and the positions of the page's text,
and SHALL quote it in the comment's entry.

The quoted passage is derived from geometry and SHALL only ever be quoted: recovering it SHALL NOT
add, drop, alter or reorder any of the page's text. A passage that cannot be recovered SHALL leave
the comment without a quotation rather than fail it.

#### Scenario: AHighlightQuotesItsPassage
- **GIVEN** a highlight covering the words "the delivery date" in a sentence
- **WHEN** the page is extracted
- **THEN** the highlight's entry quotes "the delivery date" and not the rest of the sentence

#### Scenario: AHighlightAcrossTwoLines
- **GIVEN** a highlight whose regions cover the end of one line and the start of the next
- **WHEN** the page is extracted
- **THEN** the quotation holds both parts, in reading order

#### Scenario: AnchoringLeavesTheTextAlone
- **GIVEN** a page with comments marking passages
- **WHEN** it is extracted
- **THEN** the page's content is identical to the extraction of the same page without its annotations

### Requirement: CommentsAreAnnouncedBeforeTheContent

When the extracted pages carry comments, the extraction SHALL say so before the first page's
content, stating how many comments there are and where they are listed. In `tables` mode the notice
SHALL also say that `text` mode returns them. A document without comments SHALL carry no such line.

#### Scenario: CommentsAreAnnounced
- **GIVEN** a PDF with three comments over two pages
- **WHEN** it is extracted
- **THEN** the result opens, before the first page's content, with a line counting three comments and saying they follow each page's content

#### Scenario: NoCommentsAnnounceNothing
- **GIVEN** a PDF without annotations
- **WHEN** it is extracted
- **THEN** the result carries no comments notice and no comments block

### Requirement: CommentReadingIsBounded

Reading annotations SHALL stay inside the extraction's existing time budget, and comments SHALL count
toward its character cap. At most 50 comments SHALL be listed per page and at most 2 000 characters
per remark; past either limit the output SHALL say what was left out.

A page whose annotations cannot be read SHALL still return its content, and SHALL say that its
comments could not be read. The extraction SHALL NOT fail for it.

#### Scenario: ManyCommentsAreCapped
- **GIVEN** a page with 60 notes
- **WHEN** it is extracted
- **THEN** 50 are listed and the block says 10 more were left out

#### Scenario: UnreadableAnnotationsDoNotFailThePage
- **GIVEN** a page whose annotations cannot be read
- **WHEN** it is extracted
- **THEN** its text is returned, it says its comments could not be read, and the other pages are extracted as usual
