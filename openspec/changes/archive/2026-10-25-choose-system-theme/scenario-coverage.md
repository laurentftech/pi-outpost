# Scenario coverage

Inventory checked with rg '^#### Scenario:' openspec/. OpenLore graph unavailable; CLI orient and rg/source assertion review used.

| Scenario | Status | Test |
|---|---|---|
| ChooseSystemTheme | covered | `Header.test.tsx` ChooseSystemTheme checks selection callback; `scripts/probes/system-theme.mjs` chooses System and emulates OS changes, reads widget root data-theme. |
| RestoreSystemTheme | covered | `scripts/probes/system-theme.mjs` checks stored system preference and root after reload. |
| ExplicitThemeStaysFixed | covered | `scripts/probes/system-theme.mjs` changes OS with explicit Light and Dark, checks root. |
| ThemeMenuDismissal | covered | `scripts/probes/system-theme.mjs` checks Escape and outside click close the menu without changing theme. |
| UserPrefersDarkMode | covered | `useTheme.test.ts`: lets a stored pick from an earlier visit override the configured default. |
| SystemPreferenceFollowed | covered | `useTheme.test.ts`: follows the system while set to system, as the OS switches. |
| ToggleFromLightToDark / ToggleFromDarkToLight | covered | `useTheme.test.ts`: toggles to the other theme and remembers the pick; actual widget probe selects explicit Light/Dark and checks root and storage. |

172 focused Header/useTheme/App tests and embed build passed; running-widget probe passed including keyboard transitions.
