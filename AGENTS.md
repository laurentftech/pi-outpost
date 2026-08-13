<!-- BEGIN OPENLORE (managed — edits inside this block will be overwritten) -->
<!-- openlore-fingerprint: 25cdd746ebf39b56 -->
This project uses OpenLore for persistent architectural memory.

ALWAYS call `orient()` (via the openlore MCP server, or `npx openlore orient --json`)
before reading source files when starting a new task. This returns the relevant
functions, callers, spec sections, and insertion points for the task at hand —
one structural lookup instead of file-by-file rediscovery.

OpenLore prefixes tool responses with a brief, factual freshness note (the
Epistemic Lease) once your cached context has aged or the repo has moved since
your last `orient()`. It is informational — re-`orient()` if you are relying on
cached cross-module structure; otherwise carry on.

For the MCP setup, ensure `openlore mcp` is configured as an MCP server.
See https://github.com/clay-good/OpenLore for details.
<!-- END OPENLORE -->

## Tooling & CLI Constraints
- ALWAYS use `rg` (ripgrep) instead of `grep` for code search and file inspection.
- NEVER run recursive `grep -r` commands. `rg` is faster and respects `.gitignore`.

## UI and UX changes: test them in the running app

Any change that touches the interface **or the way it is used** — a component, a
tool the agent calls, a tool's description, a message the model reads — must be
exercised in the running app with Playwright before it is called done. Unit tests
are necessary and they are not sufficient.

Three failures from one session, none of which any suite caught:

- A PDF viewer that released documents through the wrong object. The throw landed
  in an effect cleanup, so **the whole application unmounted** and the user saw a
  blank page. The test fake had grown a method the real API never had.
- A file-creation input that closed itself on a refused duplicate, swallowing the
  error. It inferred success from a side effect the failure produces too.
- An extraction tool that worked perfectly when driven directly, while the agent
  kept not using the option that made it worth having. The mechanism was right;
  the behaviour was not.

The pattern: a fake is kinder than reality, an outcome is inferred rather than
observed, or the code is correct and the *use* of it is not. Only the running app
shows those.

What "exercised" means: drive the actual feature — create the file, open the
document, ask the agent for the thing — then read back the DOM, the filesystem, or
the session transcript to check what really happened. A screenshot is not a check.
