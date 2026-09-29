# Artifact Rendering Specification

## Purpose

Renders workspace artifacts referenced in assistant messages: inline images served through
`/files/raw` and file links that open in the file viewer instead of navigating the browser.

## Requirements

### Requirement: InlineImageRendering

Assistant-message markdown SHALL render image references whose `src` is a relative path (or a path inside the workspace) as inline images, by rewriting the `src` to the `/files/raw` endpoint (including the auth token as a query parameter when one is in use). Absolute `http(s)` image URLs SHALL be rendered unchanged.

#### Scenario: RelativeImageDisplayed
- **GIVEN** the agent wrote `plot.png` in the workspace and replies with `![courbe](plot.png)`
- **WHEN** the message renders
- **THEN** the image is displayed inline in the conversation, loaded from `/files/raw?path=plot.png`

#### Scenario: ExternalImageUntouched
- **WHEN** a message contains `![logo](https://example.com/logo.png)`
- **THEN** the `src` is used as-is without rewriting

#### Scenario: BrokenImageDegradesGracefully
- **GIVEN** a referenced image that the server rejects (missing, oversize, unauthorized)
- **WHEN** the message renders
- **THEN** the layout stays intact and the failed image shows an unobtrusive fallback (alt text / broken-image state), with no error banner

### Requirement: FileLinkNavigation

Links in assistant-message markdown whose `href` is a relative path (or a path inside the workspace) SHALL open the referenced file in the file viewer instead of navigating the browser. External links SHALL open in a new tab.

#### Scenario: WorkspaceLinkOpensViewer
- **WHEN** the user clicks `[rapport](./report.html)` in an assistant message
- **THEN** the file viewer opens showing `report.html`, and the browser does not navigate away

#### Scenario: ExternalLinkNewTab
- **WHEN** the user clicks `[doc](https://example.com)` in an assistant message
- **THEN** the link opens in a new tab and the app keeps its state

### Requirement: SanitizedRawHtmlInReplies

Markup written in an assistant reply SHALL be rendered as elements rather than shown as text, after
being filtered against an allow-list of elements and attributes.

The filter SHALL apply to the whole message, including the parts markdown produced, because reply
text is untrusted whoever wrote it. It SHALL reject anything that can execute, navigate to a script,
restyle the page, frame another document, or collect input — scripts, event handlers, `javascript:`
URLs, `style` elements and attributes, framing elements, forms — and anything the allow-list does
not name. Identifiers that reach the document SHALL be namespaced, so a reply cannot shadow a global
on the page the conversation is embedded in.

The allow-list SHALL admit disclosure elements, so a section of an answer can be folded away, and
SHALL preserve the `class` of every element it keeps, so a host page can style and enhance such a
section.

Everything the conversation renders today — markdown, GFM, maths, diagrams, workspace images and
file links — SHALL render unchanged through the filter.

Markup that is not yet complete, as while a reply is still streaming, SHALL NOT prevent the rest of
the message from rendering.

#### Scenario: AStructuredSectionRendersAsElements
- **WHEN** a reply contains a `<details>` section with a `<summary>` and a body
- **THEN** the section is in the document as elements, and none of its markup is visible as text

#### Scenario: TheSectionFoldsAndUnfolds
- **WHEN** the reader activates the summary of a rendered `<details>` section
- **THEN** the section opens, and activating it again closes it

#### Scenario: TheStylingHookSurvives
- **GIVEN** a section whose elements carry classes, including on elements the default allow-list
  narrows such as a link, a list item and a code span
- **WHEN** the reply renders
- **THEN** each of those elements still carries its class

#### Scenario: ExecutableMarkupNeverReachesTheDocument
- **WHEN** a reply contains a script element, an inline event handler, or a `javascript:` link
- **THEN** none of them is in the document, and the surrounding answer still renders

#### Scenario: MarkupOutsideTheAllowListIsDropped
- **WHEN** a reply contains a framing element, a style element, a style attribute or a form
- **THEN** none of them is in the document, and the surrounding answer still renders

#### Scenario: AReplyCannotShadowAGlobal
- **WHEN** a reply gives an element an identifier
- **THEN** the identifier that reaches the document is namespaced rather than the one the reply asked for

#### Scenario: AnUnfinishedTagDoesNotBreakTheMessage
- **WHEN** a reply ends mid-tag, as it does while streaming
- **THEN** the text that arrived before it still renders

#### Scenario: ExistingRenderingIsUnchanged
- **WHEN** a reply contains a GFM table, a task list, a code fence, a mermaid diagram, inline and
  block maths, a workspace image and a workspace file link
- **THEN** each renders as it did before replies were filtered, block maths included as display maths
