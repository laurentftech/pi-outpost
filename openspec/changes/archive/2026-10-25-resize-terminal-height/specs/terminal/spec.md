## ADDED Requirements

### Requirement: ResizeTheTerminalHeight
The terminal SHALL expose a draggable, focusable top border outside maximized mode. Height SHALL range from 160 to 640 pixels, capped at 65vh, defaulting to 288 pixels. Up/Down SHALL adjust by 16 pixels; Home SHALL reset. Completed changes SHALL persist locally; cancellation SHALL roll back. Maximize/restore and minimize/reopen SHALL preserve the preference and session. Actual terminal dimensions SHALL reach the shell.

#### Scenario: ResizeTerminalHeight
- **GIVEN** an open terminal
- **WHEN** its top border is dragged vertically or adjusted with Up/Down
- **THEN** the panel follows that movement and terminal rows are resized without reopening the shell

#### Scenario: TerminalHeightBoundsAndCancel
- **GIVEN** an active height drag
- **WHEN** the pointer crosses the limits or the drag is cancelled
- **THEN** the height is bounded or restored respectively, and cancellation does not persist a change

#### Scenario: RestoreTerminalHeight
- **GIVEN** a completed height adjustment
- **WHEN** the terminal is maximized then restored, minimized then opened, or the page reloads
- **THEN** the preferred height is restored
