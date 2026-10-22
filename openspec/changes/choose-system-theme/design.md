## Context
User requests a System mode on the marked header control. OpenLore orient identified theme helpers; rg found useTheme already stores/observes system but only exposes resolved light/dark to Header. Main theme spec already requires OS change following; missing UI entry point is the discrepancy. Keep existing engine and expose preference to Header.

## Decisions
Use a three-choice radio menu, show current preference on trigger and checked item, persist through existing setTheme. Keep toggle API for compatibility. Keyboard arrows/Home/End navigate and Escape closes; host/branding precedence and hidden-control policy remain unchanged.
