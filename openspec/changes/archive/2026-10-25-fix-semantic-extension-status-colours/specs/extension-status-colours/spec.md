## ADDED Requirements

### Requirement: SemanticThemeStylesReachTheBrowser
The embedded extension UI context SHALL provide SDK semantic theme styling so a status built with ctx.ui.theme.fg retains its foreground colour when emitted and displayed in the header or overflow list. Hover titles SHALL remain plain text.

#### Scenario: BlackholeStyleGaugesRetainTheirColours
- **WHEN** an extension builds success, warning and error status segments through ctx.ui.theme.fg and sets the status
- **THEN** the bridge emits the styled text and the browser renders distinct semantic colours, including after folding, resizing and a fresh update after reload

### Requirement: IndexedForegroundColoursAreRendered
The ANSI renderer SHALL support indexed foreground colours in the basic palette, RGB cube and greys as well as existing truecolor. Invalid indices SHALL NOT produce invalid CSS colours and colour resets SHALL clear the foreground.

#### Scenario: HeadlessIndexedColoursRemainVisible
- **WHEN** a status uses indexed foreground escapes followed by a colour reset
- **THEN** each valid indexed segment has its corresponding browser colour, reset text has no foreground override and escape bytes are absent from the visible text

### Requirement: BundledExtensionThemesNeedNoAdjacentAssets
A standalone server SHALL start and provide coloured semantic extension statuses without SDK theme JSON files beside its bundle. When the built-in dark assets cannot be loaded, the bridge SHALL use the SDK-generated system theme, without dropping colours or failing context binding.

#### Scenario: BundledStatusesWorkWithoutThemeFiles
- **WHEN** the real bridge is bundled and run outside node_modules and the SDK binds its UI context
- **THEN** reading the theme during binding succeeds and success, warning and error statuses remain distinctly coloured; the packaged server still starts and answers its version handshake
