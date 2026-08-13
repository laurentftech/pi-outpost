## Context

See `proposal.md` — Why. What shapes the approach:

- **`scopeToRoot` confines one argument.** `server/src/sandbox.ts` wraps every sandboxed tool so
  that its `path` parameter must resolve inside the zone. It inspects `params.path` and nothing
  else, which is why both extraction tools name their source parameter `path` and get their
  confinement for free. A **second** path argument is outside that wrapper entirely.
- **The read tools do not know the writable zone.** `createSandboxedTools` computes
  `realWritableRoot` only inside its `if (sandbox.allowWrite)` branch, for `edit` and `write`. The
  document readers are built in the read branch and are handed the read zone plus its exceptions.
- **The browser's own writer already answers these questions.** `writeFileFromBrowser` in
  `fileBrowser.ts` refuses a read-only sandbox, refuses a path outside the writable zone, and
  `createFileFromBrowser` refuses an existing path with one syscall rather than a stat-then-write.
- **Read exceptions widen reading only.** Skill and prompt directories outside the root are readable
  and must stay unwritable — the existing `ExceptionDoesNotGrantWriteAccess` scenario.

## Goals / Non-Goals

**Goals:**
- A whole document in one call, by asking for it rather than by looping correctly.
- A whole document on disk at no context cost.
- One permission story for the destination, borrowed from the writer that already has one.

**Non-Goals:**
- Several documents per call, or a default destination. An explicit path is the feature.
- Output formats other than the markdown these tools already produce.
- Making the readers writable in any other sense: no editing, no deleting, no appending.

## Decisions

### D1 — `output_path` is checked by the tool, because the wrapper cannot

`scopeToRoot` reads `params.path`. Adding `output_path` to the schema does **not** extend that
check, so the destination arrives unconfined unless the tool confines it. This is the single most
important line of this change: a read-only sandbox that gains a write is not a smaller bug than a
missing confinement, it is the same bug.

The tool therefore resolves the destination with `realResolve` and checks `isWithin(writableRoot, …)`
itself — the same primitives `fileBrowser.ts` uses, never a new implementation.

*Alternative — teach `scopeToRoot` about a second parameter.* Rejected: it would make every tool's
confinement depend on a convention about argument names, and the next tool with a differently named
path would silently miss it. A tool that takes a destination is a tool that must say where the
destination may point.

### D2 — The writable zone is passed in, and its absence means "no destination"

`createSandboxedTools` computes the writable zone in its write branch; the readers get it as an
option: `writableRoot: string | null` where `null` means writing is disabled. On the non-sandboxed
path the zone is the browser root, matching `writeFileFromBrowser`'s rule that without a sandbox
anything under the root is writable.

A `null` zone makes `output_path` a refusal, not an error the caller has to anticipate: the message
says writing is disabled and the ordinary extraction still returns content.

**Read exceptions are not passed.** They widen reading; a skill directory outside the root stays
unwritable, exactly as it does for `edit`.

### D3 — `output_path` implies the whole document

A destination writes the complete extraction, never a capped one. A file that silently holds the
first 20 pages of a 300-page report is worse than no file: it looks finished. So `output_path`
implies `full`, and the caps that apply are the absolute ceiling and the deadline.

### D4 — Two ceilings, not one

- **The per-call cap** (20 pages / 200 blocks / 40 000 characters) stays the default. It is right
  for "look at this document", which is most calls.
- **`full: true`** lifts it to an absolute ceiling of 400 000 characters — roughly 100 000 tokens,
  which is a deliberate choice a caller makes, not one it stumbles into.
- Past that ceiling, in the conversation, the call is **refused** with a message naming
  `output_path`. Truncating there would recreate the exact failure this change exists to remove.

Writing to a file has no character ceiling of its own: the file-size limit and the deadline already
bound it, and the content is not competing for context.

### D5 — Never overwrite

An existing destination is refused, naming the path. `fs.writeFile(dest, content, { flag: "wx" })`
does the existence check and the creation in one syscall, so there is no window in which the path
could appear — the same reasoning as `createFileFromBrowser`.

*Alternative — overwrite a file this tool wrote.* It would need a provenance marker in the file and
a convention to maintain, and the failure mode of getting it wrong is destroying work.

### D6 — What a writing call returns

The destination path, the coverage (pages or blocks, and the document's total), the bytes written,
and the first few lines. Enough for the agent to confirm what happened and to decide what to read
next — and deliberately not the content, since carrying it would defeat the purpose.

## Risks / Trade-offs

- **A second path argument in a tool the wrapper only half-covers** → D1, plus tests that drive the
  destination through traversal, an absolute path, a symlink, and a prefix look-alike, exactly as
  the source path is tested today.
- **`full: true` can still cost 100 000 tokens** → it is opt-in, the ceiling refuses beyond that,
  and the refusal names the cheaper option.
- **An agent may reach for `output_path` when the user only wanted an answer**, leaving files
  behind. The tool description says what each option is for; the refusal-to-overwrite keeps the mess
  bounded to new names.
- **Writing makes these tools observable in the workspace** — a created file broadcasts
  `file_changed`, so a tree refresh follows. That is the existing machinery, but it is new for a
  tool that used to be invisible.

## Migration Plan

Additive: two optional parameters, no protocol change, no configuration change. A caller that names
neither gets exactly today's behaviour. Rolling back is removing the parameters and the writable
zone passed to the readers.
