# Pi Outpost next to pi, OpenCode and Kilo Code

> **Working notes, not a published claim.** The figures are provisional and this page is
> not linked from the README. It is kept because it is worth maintaining — re-run the
> probe when a tool or a prompt changes — and it becomes publishable when the numbers have
> been checked on more than one machine and one run.


Measured on **2026-09-04**, against **pi-outpost 0.21.0** and the **pi SDK 0.84.4** it
bundles. All four columns are measured — OpenCode **1.18.27** and Kilo Code **7.5.9**
were installed and run for this page. The features are read from documentation and
behaviour; the context figures come from the probes described below and can be re-run.

The point of this page is not a scoreboard. pi and OpenCode start in the terminal, Pi
Outpost starts in the browser, and Kilo Code spans a terminal agent and IDE extensions;
they are picked for different reasons. What is worth comparing is what you get without
assembling it yourself, and what it costs you in context before you have said anything.

## What is included

| | pi | Pi Outpost | OpenCode | Kilo Code |
|---|---|---|---|---|
| Interface | terminal TUI | browser, installable as an app | terminal TUI | terminal TUI, VS Code and JetBrains extensions |
| Runs where the files are | local | local or a server you reach over the network | local | local; cloud agents are also available |
| Several projects at once | one session, one directory | yes — each with its own agent, sandbox, history | one session per instance | one workspace per local session; cloud agents run separately |
| Sandbox / permissions | tool allowlist | read root, writable root, write and bash switches, per project, editable from the interface | permission rules per tool and pattern | allow, ask or deny rules per tool; optional `--auto` mode |
| File browser and editor | — | tree, syntax-highlighted viewer, editor confined to the writable zone | — | through the host IDE; CLI edits through tools |
| Git | through bash | change badges, per-file diffs, log, per-file history graph, multi-repository workspaces | through bash | through the terminal, plus turn diffs, checkpoints and commit generation |
| PDF and Office | — | `pdf_extract`, `docx_extract`, `xlsx_extract`, `pptx_extract`, no shell and no external binary | — | — |
| Structured results | — | a tool can hand back a graph, a sequence or a table and the interface draws it | — | — |
| Work plans | — | agent-owned plan with dependencies, evidence and review states, published in two halves | to-do list tool | to-do list tool |
| Embeddable in another app | — | `@pi-outpost/embed`, Shadow-DOM isolated | — | — |
| Standalone executable | — | one per platform, no Node needed | single binary | single CLI binary |
| Local or gateway models | any OpenAI-compatible endpoint | the same, declarable from the browser | many providers, catalogue-driven | many providers, including local and custom OpenAI-compatible endpoints |
| Sharing a session | — | anyone who can reach the server sees the same conversation | shareable session links | shareable sessions; remote control through a Kilo account |
| LSP diagnostics | — | — | yes | yes |
| Editor integration | — | — | IDE extensions | VS Code and JetBrains extensions |

Kilo Code's entries use its official [platform overview](https://kilo.ai/docs/code-with-ai),
[CLI reference](https://kilo.ai/docs/code-with-ai/platforms/cli-reference),
[checkpoint documentation](https://kilo.ai/docs/code-with-ai/features/checkpoints) and
[custom-model documentation](https://kilo.ai/docs/code-with-ai/agents/custom-models).

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
| **Pi Outpost, a Work Plan open** | ~1.7k tokens | 12 tools, ~4.9k | **~6.6k tokens** |
| OpenCode 1.18.27, default agent | ~2.4k tokens | 10 tools, ~5.2k | **~7.6k tokens** |
| Kilo Code 7.5.9, default agent | ~7.0k tokens | 12 tools, ~7.2k | **~14.3k tokens** |

The two Pi Outpost rows are the states one of its conversations sits in. **At rest** is
most turns of most conversations: no `work_plan_extended`, no document extractor. **A Work
Plan open** is what real work settles into, since a plan is opened once and kept for the
session — it is the figure to compare against OpenCode and Kilo Code, which carry every
default tool on every request.

A document extractor adds ~0.5k on top while it lasts, and it does not last: five turns
after its last call it is forgotten. There is deliberately no "everything published" row —
holding all four at once is a moment, not a state.

It was **~10.7k** before that work — the row this page carried when it was first written,
and the reason the work happened.

OpenCode's ten tools, largest first: `bash` 5 319 chars (~1.3k), `task` 3 856 (~1.0k),
`todowrite` 2 686 (~0.7k), `edit` 1 958, `read` 1 734, `webfetch` 1 293, `grep` 1 183,
`glob` 1 114, `write` 1 026, `skill` 676. Its prompt carries more than pi's and its tool
descriptions are written at length — and every one of them is sent on every request, which
is what puts its floor above a Pi Outpost session at rest.

Kilo Code's twelve tools are broader and larger again: `bash` 6 127 chars (~1.5k), `task`
4 380 (~1.1k), `background_process` 3 543 (~0.9k), `todowrite` 3 028 (~0.8k),
`kilo_local_recall` 2 106 (~0.5k), `grep` 1 990, `edit` 1 958, `read` 1 734,
`webfetch` 1 293, `glob` 1 114, `write` 1 026 and `skill` 676. The larger difference is
the default system prompt: 28 071 characters, before project instructions or discovered
skills, versus 9 613 for OpenCode and 5 973 for Pi Outpost at rest.

The comparison worth drawing is the two `todowrite` definitions against `work_plan`: the
same job — an agent-owned list of what it is doing — at **2 686 characters in OpenCode,
3 028 in Kilo Code and 4 331 in Pi Outpost**. Pi Outpost's definition was
16 160 when this page was first written, which is what prompted the work: 73 copies of one
regex, a second way to spell `update_task`, the collection shapes for four operations that
cannot be called before a plan exists, and 92 length bounds restating what the normaliser
already enforced. What is left does more than `todowrite` — dependencies, evidence, review
states — and is now within 1.6× of its size.

Per tool, largest first, in the state each is actually sent in:

| Tool | chars | ~tokens | Sent |
|---|---|---|---|
| `bash` (Kilo Code) | 6 127 | ~1.5k | always |
| `bash` (OpenCode) | 5 319 | ~1.3k | always |
| `work_plan_extended` | 4 602 | ~1.2k | once the session has a plan, then kept |
| `work_plan` | 4 331 | ~1.1k | always |
| `xlsx_extract` | 2 345 | ~0.6k | while a spreadsheet is in play |
| `write_structure_figure` | 2 195 | ~0.5k | always |
| `docx_extract` | 2 027 | ~0.5k | while a Word file is in play |
| `pdf_extract` | 1 944 | ~0.5k | while a PDF is in play |
| `pptx_extract` | 1 933 | ~0.5k | while a deck is in play |
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
and what it publishes with a Work Plan open — then reads `session.systemPrompt` and
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
- **The transient tools.** A document extractor adds ~0.5k while the document is being
  worked on and goes five turns after its last call, so neither row above includes one.
- **The sandbox.** It replaces the built-in tools with path-scoped equivalents of much
  the same size, so the figure moves little.
- **Two methods, one comparison.** pi and Pi Outpost are read from their own sessions
  (`session.systemPrompt` and `session.getAllTools()`); OpenCode and Kilo Code are read
  from the wire — each was pointed at a local OpenAI-compatible endpoint that logged the
  request, and the figures are the `system` messages and the `tools` array it actually
  sent. The wire is the stricter method, so their numbers are, if anything, the more
  conservative ones.
- **OpenCode's environment.** Run with `--pure` and a clean `HOME`, so no plugins, no
  project `AGENTS.md`, and none of the skills it would otherwise discover — including,
  on this machine, the ones under `~/.claude/skills`.
- **Kilo Code's environment.** Run with `--pure`, clean XDG state, data, config and cache
  directories, an empty working directory, and a custom OpenAI-compatible model. Its
  `kilo_local_recall` tool is still part of the default request, but had no stored memory
  to recall.
