# Change Proposal: `pi-outpost doctor`

## Why

A server that will not start and a page that will not load look identical from the
browser, and nothing in the product tells them apart.

The most common cause, reported from a Windows desktop: in a directory that has never
been used before, there is no `pi-outpost.config.json`, and `findConfigFile` throws
`NoConfigError`. The CLI prints the paths it searched and exits 1 **before it binds a
port**, so a browser pointed at `localhost:3141` finds nothing to connect to. The
operator concludes the server is broken; the server never ran. A global npm install
does not write either configuration file — the install and the configuration are
separate acts — and nothing said so.

`pi-outpost config` is the command that would explain this, and it cannot: it loads the
configuration before it prints anything, so in exactly the case worth diagnosing it
fails with the same error the operator is trying to understand.

Two further causes produce the same symptom and are equally silent:

- **The port is held by something else.** Often an earlier Pi Outpost the operator
  forgot, whose tab they may already have open.
- **The installation has no interface to serve.** With neither an embedded bundle nor a
  `web/dist` on disk, `index.ts` registers no route for the UI: the server starts,
  listens, and answers 404 for every page.

## What

A `doctor` subcommand that runs **before** the configuration is loaded and reports, in
one pass, without stopping at the first problem:

1. **installation** — version, install shape (`detectChannel`), node, platform/arch.
2. **configuration** — the file a start would read, marked in the search order; or, with
   none, both candidate paths and the two forms of `init` that write one.
3. **settings** — the address as a URL to open, the agent's working directory, the
   runtime, whether a token is set (never its value), whether the terminal is on.
4. **address** — free, held by another Pi Outpost (a warning: it is probably the one
   they want), or held by something else (a failure: a start here cannot work).
5. **web UI** — the embedded bundle, the `dist` that answered, or neither.
6. **git**, and **node-pty** when the terminal is enabled — both warnings, since the
   server runs without them.

Exit code 1 when any check would stop the server from serving; 0 otherwise, so a script
can gate on it.

## What this change does not do

It diagnoses; it does not repair. No file is written, no port is freed, no dependency is
installed. Every finding names the command the operator would run, and stops there — a
diagnostic that also acts is one that can act on a wrong diagnosis.
