# Preserve semantic extension status colours

## Why
pi-blackhole styles its status gauges with ctx.ui.theme.fg, but the embedded UI bridge returns identity functions. The UI can render ANSI, yet the bridge strips the colour before setStatus emits it. The existing browser test writes literal ANSI and misses this production path.

## What Changes
- Supply the SDK built-in dark theme in the embedded bridge, consistent with extension tool rendering.
- Decode indexed ANSI foreground colours as well as truecolor, because a headless SDK may select indexed output.
- Cover semantic success/warning/error statuses through the bridge and browser folding/reload path.

## Impact
ExtensionUiBridge, the ANSI parser, related tests and README. No pi-blackhole changes, wire schema changes or interactive theme switching. OpenLore is unavailable; targeted repository inspection identified the bridge, blackhole's src/om/status-bar.ts and existing ANSI tests. Existing status rendering is the intended behavior; the identity theme is the implementation discrepancy.
