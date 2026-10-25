## Context
Intent: drag the terminal top boundary vertically, like the other panels. OpenLore orient identified TerminalPanel; graph unavailable, so rg found PanelResizeHandle and panelWidth helpers. The terminal main spec describes toggle/tabs/PWD but no height control. No behavioral contradiction; add a requirement.

## Decisions
Extend the existing resize hook and handle with an optional y axis; x remains the default. Upward motion increases terminal height. Reuse the guarded browser storage helpers with a distinct key, 288px default, 160–640px preference, capped at 65vh when not maximized. Existing 85vh maximize stays separate, preserving the preferred height. Handle uses pointer capture, cancellation rollback and Up/Down/Home accessibility. Existing ResizeObserver refits xterm and sends PTY size without reopening it.
