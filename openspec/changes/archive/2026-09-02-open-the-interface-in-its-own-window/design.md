## Context

See `proposal.md` for motivation and `specs/cli/spec.md` for the contract.

`server/src/openBrowser.ts` already separates the three questions cleanly:
`shouldOpenBrowser()` decides *whether*, `browsableUrl()` decides *where* — from
the address actually bound, so a port chosen by the operating system is handled —
and `openerFor()` decides *how*, today by handing the URL to the platform's own
opener (`open`, `cmd /c start`, `xdg-open`). Only the third changes here.

Its current comment states the principle being reversed: *"Nothing here parses a
browser preference — the OS holds it."*

## Goals / Non-Goals

**Goals:**

- One gesture from launching the server to an interface in a window of its own.
- No regression anywhere the window cannot be presented.
- The change confined to how the interface is opened.

**Non-Goals:**

- Changing whether a browser opens, which address it opens, or the behaviour when
  opening fails.
- Requiring the interface to be installed as a web app. A window of its own does
  not depend on that, and must not start to.
- Choosing a browser for the user. What is selected here is a browser *able to
  present the window*, not a preferred one.
- Any behaviour that differs between an interface opened this way and one opened
  in a tab. It is the same interface, served by the same server.

## Decisions

### A window of its own becomes the default, with a fallback rather than a failure

The alternative is opt-in configuration, which is safer and worse: it would leave
the good behaviour behind a setting most people never find, and the case that
needs it most — a double-clicked executable, which the specification already calls
a whole application — is exactly the case where nobody is editing configuration.

What makes the default defensible is that it degrades rather than fails. Where the
window cannot be presented, the interface opens exactly as it does today, and the
server says nothing about it. So the worst case of the new default is the current
behaviour.

### `openBrowser` keeps its meaning; a separate setting carries the shape

`openBrowser` is a tri-state today — unset, true, false — and it answers *whether*.
Overloading it with a third, non-boolean value would put two questions in one
setting and make `false` ambiguous against a shape.

So the shape is its own setting, and `openBrowser` still wins: asked not to open,
nothing opens, whatever shape was configured. The command line mirrors it, since
the requirement says the decision is overridable from both.

### Naming browsers, deliberately, in one function

Presenting a window without tabs means invoking a browser that can do it, which
means naming browsers — the thing `openBrowser.ts` says it does not do. The
reversal is real and is confined to `openerFor()`: a small ordered list of
candidates per platform, the first that exists wins, and none found means the
existing opener is used.

What keeps this from becoming a browser-preference parser is that the list answers
one question — *can this present a window of its own* — and never *which browser
should the user have*. A machine with none simply gets today's behaviour.

### Failure stays invisible

The requirement already says a failed open is not a failed start. This adds a
second way to fail — a browser that exists but refuses to present the window — and
it is treated identically: the address is printed, the server runs. Nothing here
is worth an error message that suggests the operator has something to fix.

## Risks / Trade-offs

- [A visible default change: someone who wanted a tab now gets a window] → The
  setting restores it in both directions, and the fallback means the change is
  invisible on machines that cannot present the window at all.
- [A window without an address bar hides which server is being talked to, which
  matters once several projects or several deployments exist] → The interface
  already names its project and its branding in its own header; the address bar
  was not what carried that.
- [Naming browsers ages badly as they are renamed or repackaged] → The list is
  ordered candidates with a fallback, so an entry that stops matching costs
  today's behaviour rather than a failure, and the fallback is exercised as a
  scenario rather than assumed.
- [A window of its own on a machine where the interface was also installed as a
  web app could present two different-looking windows for the same thing] → They
  are the same window shape presented by the same browser; what differs is only
  whether the browser also has an icon for it.
