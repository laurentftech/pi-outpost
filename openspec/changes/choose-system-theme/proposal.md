## Why
The theme engine supports system preference but the header only offers light/dark toggling, so users cannot return to following the OS.

## What Changes
- Offer Light, Dark and System in the header theme menu.
- Show and persist the selected preference separately from the resolved color.
- Preserve host theme precedence and allowThemeToggle.

## Capabilities
### Modified Capabilities
- theme: explicit system choice in the header.

## Impact
Theme hook return value, header menu, app wiring, tests and README.
