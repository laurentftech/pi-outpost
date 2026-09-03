# Pi Outpost next to pi and opencode

> **Working notes, not a published claim.** The figures are provisional and this page is
> not linked from the README. It is kept because it is worth maintaining — re-run the
> probe when a tool or a prompt changes — and it becomes publishable when the numbers have
> been checked on more than one machine and one run.


Measured on **2026-09-03**, against **pi-outpost 0.20.1** plus the tool work that followed
it (#162, #164, #166, #167), and the **pi SDK 0.84.4** it bundles. All three columns are measured — opencode **1.18.27**, installed and run for this
page. The features are read from documentation and behaviour; the context figures come
from the probes described below and can be re-run.

The point of this page is not a scoreboard. Two of the three are terminal agents and one
is a web interface; they are picked for different reasons. What is worth comparing is
what you get without assembling it yourself, and what it costs you in context before you
have said anything.

## What is included

| | pi | Pi Outpost | opencode |
|---|---|---|---|
| Interface | terminal TUI | browser, installable as an app | terminal TUI |
| Runs where the files are | local | local or a server you reach over the network | local |
| Several projects at once | one session, one directory | yes — each with its own agent, sandbox, history | one session per instance |
| Sandbox / permissions | tool allowlist | read root, writable root, write and bash switches, per project, editable from the interface | permission rules per tool and pattern |
| File browser and editor | — | tree, syntax-highlighted viewer, editor confined to the writable zone | — |
| Git | through bash | change badges, per-file diffs, log, per-file history graph, multi-repository workspaces | through bash |
| PDF and Office | — | `pdf_extract`, `docx_extract`, `xlsx_extract`, `pptx_extract`, no shell and no external binary | — |
| Structured results | — | a tool can hand back a graph, a sequence or a table and the interface draws it | — |
| Work plans | — | agent-owned plan with dependencies, evidence and review states, published in two halves | to-do list tool |
| Embeddable in another app | — | `@pi-outpost/embed`, Shadow-DOM isolated | — |
| Standalone executable | — | one per platform, no Node needed | single binary |
| Local or gateway models | any OpenAI-compatible endpoint | the same, declarable from the browser | many providers, catalogue-driven |
| Sharing a session | — | anyone who can reach the server sees the same conversation | shareable session links |
| LSP diagnostics | — | — | yes |
| Editor integration | — | — | IDE extensions |

pi is the agent underneath Pi Outpost, so the second column is the first plus what the
web interface adds. Nothing in it is a criticism of the terminal: a TUI is the right
shape for a machine you are sitting at, and the interface exists for the machines you
are not.

## What a session costs before you say anything

The system prompt and the tool definitions are sent on every turn. They are the floor of
every conversation, and the first thing to look at when a context window feels small.

| | system prompt | tools | baseline |
|---|---|---|---|
| pi, default toolset | ~0.7k tokens | 8 tools, ~1.7k | **~2.4k tokens** |
| **Pi Outpost, at rest** | ~1.5k tokens | 11 tools, ~3.8k | **~5.2k tokens** |
| opencode 1.18.27, default agent | ~2.4k tokens | 10 tools, ~5.2k | **~7.6k tokens** |
| Pi Outpost, everything published | ~2.0k tokens | 16 tools, ~7.0k | ~9.0k tokens |

**At rest** is what almost every turn of almost every conversation carries. Five tools are
withheld until something asks for them: `work_plan_extended` until the session has a plan,
and the four document extractors until a document of their kind is named. A session that
plans and reads documents ends up at the last row; one that refactors TypeScript stays at
the second.

It was **~10.7k** before that work — the row this page carried when it was first written,
and the reason the work happened.

opencode's ten tools, largest first: `bash` 5 319 chars (~1.3k), `task` 3 856 (~1.0k),
`todowrite` 2 686 (~0.7k), `edit` 1 958, `read` 1 734, `webfetch` 1 293, `grep` 1 183,
`glob` 1 114, `write` 1 026, `skill` 676. Its prompt carries more than pi's and its tool
descriptions are written at length — and every one of them is sent on every request, which
is what puts its floor above a Pi Outpost session at rest.

The comparison worth drawing is `todowrite` against `work_plan`: the same job — an
agent-owned list of what it is doing — at **2 686 characters against 4 331**. It was
16 160 when this page was first written, which is what prompted the work: 73 copies of one
regex, a second way to spell `update_task`, the collection shapes for four operations that
cannot be called before a plan exists, and 92 length bounds restating what the normaliser
already enforced. What is left does more than `todowrite` — dependencies, evidence, review
states — and is now within 1.6× of its size.

Per tool, largest first, in the state each is actually sent in:

| Tool | chars | ~tokens | Sent |
|---|---|---|---|
| `work_plan_extended` | 4 602 | ~1.2k | once the session has a plan |
| `work_plan` | 4 331 | ~1.1k | always |
| `bash` (opencode) | 5 319 | ~1.3k | always |
| `xlsx_extract` | 2 345 | ~0.6k | once a spreadsheet is named |
| `write_structure_figure` | 2 195 | ~0.5k | always |
| `docx_extract` | 2 027 | ~0.5k | once a Word file is named |
| `pdf_extract` | 1 944 | ~0.5k | once a PDF is named |
| `pptx_extract` | 1 933 | ~0.5k | once a deck is named |
| `edit` | 1 773 | ~0.4k | always |
| `present_structure` | 1 535 | ~0.4k | always |
| `grep` | 1 107 | ~0.3k | always |
| `read` | 824 | ~0.2k | always |
| `powershell` | 734 | ~0.2k | always |
| `bash` | 716 | ~0.2k | always |
| `find` | 684 | ~0.2k | always |
| `write` | 573 | ~0.1k | always |
| `ls` | 538 | ~0.1k | always |

`work_plan` is still the largest thing sent to every conversation, and the four extractors
together are still about the size of pi's entire toolset — but none of the five is sent to a
session that has no use for it. The shape of any further optimisation is the same as the
last one: one tool's definition, not the distribution of sixteen.

## How the figures were produced

```bash
npx tsx server/scripts/probe-context-baseline.mts
```

It builds three real `AgentSession`s — pi's defaults, what pi-outpost publishes at rest,
and everything it can publish — then reads `session.systemPrompt` and
`session.getAllTools()`, counting the JSON of each tool's name, description, prompt
guidelines and parameter schema. The resting figure withholds the on-demand tools through
`setActiveToolsByName`, the way the server does, rather than subtracting them afterwards:
pi rebuilds the system prompt around the active set, so a withheld tool takes its
guidelines with it — 2 074 characters that a subtraction would have counted anyway. Reading the sources
instead would miss where a tool's guidelines actually land, which is in the prompt.

Tokens are **characters ÷ 4**. That is an order of magnitude, not a bill: the real count
depends on the tokenizer, and a JSON schema tokenizes worse than prose. It is accurate
enough to tell a 4k tool from a 0.2k one, which is the decision this page is for.

### What is not measured

- **Skills, extensions and project context files.** Discovery is off in the probe. A
  deployment that loads skills pays for them on top, and that cost belongs to the
  deployment rather than to the software.
- **What a conversation goes on to publish.** The resting figure is the floor, not the
  average: a session that opens a work plan adds ~1.2k tokens for the rest of it, and one
  that reads a spreadsheet adds ~0.6k until five turns pass without another call.
- **The sandbox.** It replaces the built-in tools with path-scoped equivalents of much
  the same size, so the figure moves little.
- **Two methods, one comparison.** pi and pi-outpost are read from their own sessions
  (`session.systemPrompt` and `session.getAllTools()`); opencode is read from the wire —
  it was pointed at a local OpenAI-compatible endpoint that logged the request, and the
  figures are the `system` messages and the `tools` array it actually sent. The wire is
  the stricter of the two, so if anything opencode's number is the more generous.
- **opencode's environment.** Run with `--pure` and a clean `HOME`, so no plugins, no
  project `AGENTS.md`, and none of the skills it would otherwise discover — including,
  on this machine, the ones under `~/.claude/skills`.
