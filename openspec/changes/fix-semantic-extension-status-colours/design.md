## Decision
Use the same SDK theme module already imported by ExtensionRenderer, choosing the standalone built-in dark theme rather than the process-global interactive theme. Keep the SDK semantic token contract instead of inventing a small blackhole-specific palette. This preserves foreground styling for all extensions using ctx.ui.theme. Browser theme switching and terminal background rendering remain outside this fix.

The SDK may choose 256-colour ANSI in a headless process. Map indices 0–15 through the existing accessible basic palette, 16–231 through the standard RGB cube and 232–255 through the standard greys. Invalid indices do not become CSS colours. Preserve the existing truecolor, resets and plain hover titles.

## Evidence and validation limits
The previous bridge test explicitly required identity stylers. Replace that incorrect contract with assertions that semantic colours are emitted unchanged by setStatus. Extend the existing running-app test to generate statuses with ctx.ui.theme, assert distinct warning/error spans, fold/unfold, resize and regenerate after reload.

The local parser can run under Node 24 without dependencies and its indexed-colour regression checks pass. Full server tests and the actual app/Playwright test cannot currently run because cloning/installing through the environment proxy fails. Do not call this fix complete until those checks pass. The browser fixture reproduces blackhole's API usage; actual blackhole integration should also be exercised before release.

## Packaged startup regression found in CI

The first CI run passed browser and source bridge tests but failed all five versionsBundled server tests: getThemeByName(dark) reads SDK JSON relative to its relocated module, unavailable in a single-file bundle. Spreading the UI context during SDK binding evaluates the theme getter, so throwing there prevents server startup even without a status-producing extension.

Use the SDK-generated system theme when the dark JSON assets cannot be loaded. It requires no files and retains semantic colours instead of reverting to identity stylers. A regression bundles the real bridge and ANSI parser, runs it outside node_modules, evaluates the getter through object spread and checks three distinct colours. Run this and the existing five packaged-server tests early in CI on both platforms.
