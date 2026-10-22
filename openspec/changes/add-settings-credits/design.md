# Design

Intent: a bottom-of-settings credits subpage with the supplied project URL and draw.io attribution. OpenLore orient was called; no usable graph was available, so targeted rg inspection located SettingsMenu and the vendored draw.io LICENSE. Existing specs had no credits requirement. A new settings-credits capability records the intent without changing existing settings behavior.

Use the existing settings popup, keeping draft state in SettingsMenu. Copy notices verbatim from the bundled draw.io license and installed major dependencies into ui/src/credits.ts; update these notices when upgrading those components. The list explicitly says selected components and does not claim an exhaustive dependency audit. Full license texts are expandable and local; upstream links open in a separate tab.

## Presentation revision
User feedback rejects nested accordions and an unexplained link list. Following the separate ThirdPartyNotices approach documented by VS Code, show an About-style project identity and compact component/role rows, with a single action opening a consolidated locally bundled notice document. Existing requirement for expandable licenses conflicts with this intent; replace it with a separate document view before implementation. MIT and Apache texts remain verbatim; external per-license links are not required for this UI.
