## ADDED Requirements

### Requirement: ChooseThemePreference
When theme controls are enabled, the header SHALL offer Light, Dark and System choices, expose the selected preference, and persist it. System SHALL follow OS color-scheme changes without reloading. Explicit Light or Dark SHALL remain fixed across OS changes. Host precedence and branding.allowThemeToggle SHALL remain unchanged.

#### Scenario: ChooseSystemTheme
- **GIVEN** a user previously chose Light or Dark
- **WHEN** they choose System from the theme menu
- **THEN** the menu marks System and the theme follows subsequent OS changes

#### Scenario: RestoreSystemTheme
- **GIVEN** the user chose System
- **WHEN** the page reloads without a host override
- **THEN** System remains selected and resolves to the current OS preference

#### Scenario: ExplicitThemeStaysFixed
- **GIVEN** an explicit Light or Dark choice
- **WHEN** the OS preference changes
- **THEN** the chosen explicit theme stays applied

#### Scenario: ThemeMenuDismissal
- **GIVEN** an open theme menu
- **WHEN** Escape or an outside click is used
- **THEN** the menu closes without changing the preference
