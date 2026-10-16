# The Claude Desktop planning view follows the host's theme

## Why

In a dark Claude Desktop the planning view stayed a white card. It was a choice: the
card was "the same figure the person would export". Since structured-exchange figures
paint night colours on screen while every export keeps the day colours, that reason no
longer holds, and the host states its theme to the view, live.

## What Changes

- The view puts the host's theme (`hostContext.theme`, and its live changes) on its root,
  so the card, the timeline's frame and its figure take their dark variants and night
  colours in a dark host.
- The plannings list gains dark variants.
- Download SVG and copy markup still give the light figure.

## Impact

`mcp/viewer/main.tsx`; the e2e MCP Apps host can switch theme live. No server, tool or
contract change.
