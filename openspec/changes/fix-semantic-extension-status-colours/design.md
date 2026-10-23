## Decision
Use the same SDK theme module already imported by ExtensionRenderer, choosing the standalone built-in dark theme rather than the process-global interactive theme. Keep the SDK semantic token contract instead of inventing a small blackhole-specific palette. This preserves foreground styling for all extensions using ctx.ui.theme. Browser theme switching and terminal background rendering remain outside this fix.

The SDK may choose 256-colour ANSI in a headless process. Map indices 0–15 through the existing accessible basic palette, 16–231 through the standard RGB cube and 232–255 through the standard greys. Invalid indices do not become CSS colours. Preserve the existing truecolor, resets and plain hover titles.

## Evidence and validation limits
The previous bridge test explicitly required identity stylers. Replace that incorrect contract with assertions that semantic colours are emitted unchanged by setStatus. Extend the existing running-app test to generate statuses with ctx.ui.theme, assert distinct warning/error spans, fold/unfold, resize and regenerate after reload.

The local parser can run under Node 24 without dependencies and its indexed-colour regression checks pass. Full server tests and the actual app/Playwright test cannot currently run because cloning/installing through the environment proxy fails. Do not call this fix complete until those checks pass. The browser fixture reproduces blackhole's API usage; actual blackhole integration should also be exercised before release.
