## Purpose

Retouching a poster where it is shown — in Claude Desktop, pi-outpost or Open WebUI — without leaving the conversation or the workspace: correcting texts, moving and styling elements, then saving or exporting.

## ADDED Requirements

### Requirement: EditorShowsTheWholePage

The editor SHALL open a poster with its whole page in view, drawn with the poster's own markup and stylesheet — colours set through CSS variables included — and SHALL offer zoom in, zoom out and fit, and moving around a page larger than the view by scrolling.

#### Scenario: ThePageFitsWhenOpened
- **WHEN** a poster is opened in the editor
- **THEN** the whole page is visible, its colours and borders as the stylesheet says

#### Scenario: TheBottomOfAZoomedPageIsReachable
- **GIVEN** a poster zoomed in beyond the view
- **WHEN** the reader scrolls
- **THEN** the page moves, and its bottom comes into view

### Requirement: TextIsCorrectedInPlace

Double-clicking a text SHALL let the reader rewrite it where it is; the text SHALL rewrap within its element, and the layout around it SHALL follow.

#### Scenario: ALongerTextRewraps
- **WHEN** the reader rewrites a card's title with a longer sentence
- **THEN** the sentence wraps inside the card, and no text overflows the card

### Requirement: ElementsMoveAndRestyle

The reader SHALL be able to drag a selected element to another place without disturbing the layout of the others, and change the selected element's font, size, weight, colour, alignment, background and border; a change SHALL apply to that element only.

#### Scenario: APictogramIsMoved
- **WHEN** the reader drags a selected pictogram
- **THEN** it moves by the distance dragged, and the other elements stay where they were

#### Scenario: AColourChangeTouchesOneElement
- **GIVEN** six cards sharing one class
- **WHEN** the reader changes the background of one card
- **THEN** only that card changes

### Requirement: UndoAndRedo

Every change made in the editor SHALL be undoable and redoable until the poster is closed.

#### Scenario: AnEditIsUndone
- **WHEN** the reader corrects a text and then undoes
- **THEN** the text is as it was

### Requirement: SavingKeepsTheReadersVersion

Where the host saves, saving SHALL record the poster as the editor shows it, against the revision the editor opened, and SHALL say it was saved; the model's next read SHALL return that version.

#### Scenario: TheModelReadsTheTouchUps
- **WHEN** the reader corrects a text and saves
- **THEN** the model's next read of the poster returns the corrected text, marked as changed by the user

### Requirement: AStaleSaveIsRefused

A save SHALL be refused, and the editor SHALL say so, when the poster changed since the editor opened it; nothing SHALL be overwritten unseen.

#### Scenario: TheModelChangedThePosterMeanwhile
- **GIVEN** an editor open on revision 3, and the model has since saved revision 4
- **WHEN** the reader saves
- **THEN** the save is refused with a message naming revision 4, and revision 4 is unchanged

### Requirement: StylePanelGivesWayInline

The style panel SHALL be closed when the editor is shown inline in a conversation and open in full screen, and the reader SHALL be able to open or close it in either.

#### Scenario: InlineThePageHasTheRoom
- **WHEN** a poster is shown inline
- **THEN** the style panel is closed until the reader opens it

### Requirement: EditorFollowsTheHostTheme

The editor's own surfaces SHALL follow the host's light or dark theme, also when the theme changes while it is open; the poster SHALL keep its own colours.

#### Scenario: TheThemeChangesWhileOpen
- **GIVEN** a poster open in a light host
- **WHEN** the host switches to dark
- **THEN** the editor's bar and surroundings turn dark, and the poster's colours do not change

### Requirement: EditorIsVisibleInItsHost

The editor SHALL keep a height of its own inline, so a host that sizes the frame from its content shows it, and SHALL stay clear of host controls drawn over the bottom of the window in full screen.

#### Scenario: InlineTheEditorIsSeen
- **WHEN** a host sizes the editor's frame from the page's own height
- **THEN** the editor is shown at its inline height, not collapsed

#### Scenario: FullScreenLeavesTheReplyBarClear
- **WHEN** the editor is in full screen in Claude Desktop
- **THEN** the bottom of the editor is above Claude's reply bar

### Requirement: EditorIsIsolated

The editor and the poster it shows SHALL run where they can reach neither the host application, its storage nor its credentials, and SHALL make no network request.

#### Scenario: APosterCannotReachTheApplication
- **GIVEN** a poster whose markup carries an event handler attribute
- **WHEN** it is shown in the pi-outpost editor
- **THEN** the handler does not run, and nothing in the frame can read the application's token
