## Why
The terminal has a fixed height while other panels have draggable borders. Users need to allocate screen space by dragging its top boundary.

## What Changes
- Reuse the panel resize handle and browser preference helpers for vertical terminal resizing.
- Keep maximize/restore and background terminal sessions working.
- Keep terminal dimensions synchronized with the panel via its existing ResizeObserver.

## Capabilities
### Modified Capabilities
- terminal: adjustable height.

## Impact
Shared panel resize component, terminal panel, tests and README.
