# Embed Specification

> Authored from openlore `prepare_spec_generation` evidence on 2026-08-11
> Anchors verified against the analysis graph; no overlap with existing specs

## Purpose

The embedding contract: how a host application mounts pi-outpost into one of its
own elements, isolated from the host page's CSS in both directions, and how it
controls the widget afterwards. This is the only surface a consumer of the
published package touches.

## Requirements

> `embed/src/mount.tsx`

### Requirement: MountIntoAHostElement

- **Implementation**: `mount::embed/src/mount.tsx`

The system SHALL mount the application into a caller-supplied container element
inside a **Shadow DOM**, so isolation holds in both directions: the widget's CSS
reset never reaches the host page, and the host page's styles never bleed into the
widget. It SHALL return a handle for controlling the mounted instance.

#### Scenario: HostPageWithItsOwnStyles
- **GIVEN** a host page with global CSS
- **WHEN** the widget is mounted into a container
- **THEN** the widget renders with its own styles
- **AND** neither side's rules affect the other

### Requirement: ConfigureTheMountedWidget

- **Implementation**: `mount::embed/src/mount.tsx`

> `MountOptions`, `MountHandle` and `Theme` are type declarations. The link
> index covers behaviour, not types, so they cannot be anchored; `mount` is the
> exported function that implements this requirement.

The system SHALL accept mount options and apply the following defaults: the
backend origin defaults to the host page's own origin; the initial theme falls
back to the server's `branding.defaultTheme`, then to `"system"`; and a supplied
auth token SHALL be used directly, so a host that already authenticates its user
never sees a token screen.

#### Scenario: HostSuppliesItsOwnToken
- **GIVEN** a server configured with `server.token` and a host that passes it
- **WHEN** the widget mounts
- **THEN** the session authenticates with that token
- **AND** no token prompt is shown

#### Scenario: NoBackendOriginGiven
- **GIVEN** mount options without a `serverUrl`
- **WHEN** the widget mounts
- **THEN** it targets the host page's own origin

### Requirement: ControlAndUnmountTheWidget

- **Implementation**: `mount::embed/src/mount.tsx`

> `MountOptions`, `MountHandle` and `Theme` are type declarations. The link
> index covers behaviour, not types, so they cannot be anchored; `mount` is the
> exported function that implements this requirement.

The returned handle SHALL expose `unmount()` and `setTheme()`. Unmounting SHALL
tear down the React tree and leave the caller's container **in the DOM**, with an
empty shadow root — the host owns that element and the widget must not remove it.
`setTheme()` SHALL let the host drive the theme, which is the case when it
disables the widget's own toggle.

#### Scenario: HostRemovesTheWidget
- **GIVEN** a mounted widget
- **WHEN** `unmount()` is called
- **THEN** the React tree is torn down
- **AND** the host's container element remains in the DOM

#### Scenario: HostDrivesTheTheme
- **GIVEN** a host application that manages light/dark itself
- **WHEN** it calls `setTheme("dark")`
- **THEN** the widget applies the dark theme to its own root

### Requirement: PublishAStandaloneTypeSurface

- **Implementation**: `mount::embed/src/mount.tsx`

> `MountOptions`, `MountHandle` and `Theme` are type declarations. The link
> index covers behaviour, not types, so they cannot be anchored; `mount` is the
> exported function that implements this requirement.

The published type surface SHALL NOT import from the repository's private shared
package: a shipped `mount.d.ts` referencing it would resolve to nothing in a
consumer's project. The theme union SHALL therefore be spelled out here, and kept
in step with the shared definition by assignment.

#### Scenario: ConsumerCompilesAgainstThePackage
- **GIVEN** a consumer project with only the published package installed
- **WHEN** it type-checks against `mount.d.ts`
- **THEN** every referenced type resolves without the private package

## Technical Notes

- **Isolation mechanism**: Shadow DOM, chosen over an iframe so the widget shares
  the host's page context while keeping styles separate.
- **Related**: the theme applied here targets the widget's own root element rather
  than the document root — see the Theme specification.
