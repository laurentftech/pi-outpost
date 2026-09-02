## Why

Starting the server opens the interface as a tab in whatever browser was already there, among that browser's other tabs, wearing its address bar. The interface is not a page someone is visiting — it is the application they launched, and it has just been made installable as one.

Reaching that window today takes a second gesture: start the server, then find and click the installed app. Two clicks for one intention, and the second one is easy to miss — which leaves a user looking at a tab and wondering whether that is the application.

## What Changes

- Open the interface in a window of its own — no tabs, no address bar — where the machine has a browser that can present one.
- **This becomes the default.** The interface has one address and one purpose, and every way of starting it benefits: a double-clicked executable most of all, since that is the case the specification already calls a whole application.
- Fall back to opening the interface the way it opens today wherever a window of its own is not available. A machine whose browser cannot do this SHALL behave exactly as it does now.
- Let the operator ask for the old behaviour explicitly, for anyone who would rather have a tab.
- Change nothing about *whether* a browser opens, which address it opens, or what happens when opening fails. Those decisions stay where they are; this changes only the shape of the window.

## Capabilities

### Modified Capabilities

- `cli`: `StartingOpensTheInterface` currently requires the interface to open in the default browser. It gains the window's shape as part of the contract — its own window by default, the current behaviour as a fallback and as an explicit choice — while every other guarantee in that requirement stands unchanged.

## Impact

- The one function that decides how the interface is opened, and the configuration that selects it.
- A documented decision is deliberately reversed: that code says today that it parses no browser preference because the operating system holds it. Presenting a window of its own requires naming a browser that can do it, so the reversal has to be written down rather than absorbed.
- No change to the server, the protocol, the interface, or the widget.
