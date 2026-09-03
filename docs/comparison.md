# Pi Outpost next to pi and opencode

> **Working notes, not a published claim.** The figures are provisional and this page is
> not linked from the README. It is kept because it is worth maintaining — re-run the
> probe when a tool or a prompt changes — and it becomes publishable when the numbers have
> been checked on more than one machine and one run.


Measured on **2026-09-03**, against **pi-outpost 0.20.1** and the **pi SDK 0.84.4** it
bundles. All three columns are measured — opencode **1.18.27**, installed and run for this
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
| Work plans | — | agent-owned plan with dependencies, evidence and review states | to-do list tool |
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
| opencode 1.18.27, default agent | ~2.4k tokens | 10 tools, ~5.2k | **~7.6k tokens** |
| Pi Outpost, default configuration | ~1.9k tokens | 15 tools, ~8.8k | **~10.7k tokens** |

opencode's ten tools, largest first: `bash` 5 319 chars (~1.3k), `task` 3 856 (~1.0k),
`todowrite` 2 686 (~0.7k), `edit` 1 958, `read` 1 734, `webfetch` 1 293, `grep` 1 183,
`glob` 1 114, `write` 1 026, `skill` 676. Its prompt carries more than pi's and its tool
descriptions are written at length; the totals land between the two others.

The comparison worth drawing is `todowrite` against `work_plan`: the same job — an
agent-owned list of what it is doing — at **2 686 characters against 16 160**. Work
plans do more (dependencies, evidence, review states), but not six times more.

Per tool, largest first — this is where the difference actually is:

| Tool | chars | ~tokens | |
|---|---|---|---|
| `work_plan` | 16 160 | ~4.0k | Pi Outpost |
| `bash` (opencode) | 5 319 | ~1.3k | opencode |
| `xlsx_extract` | 2 345 | ~0.6k | Pi Outpost |
| `write_structure_figure` | 2 195 | ~0.5k | Pi Outpost |
| `docx_extract` | 2 027 | ~0.5k | Pi Outpost |
| `pdf_extract` | 1 944 | ~0.5k | Pi Outpost |
| `pptx_extract` | 1 933 | ~0.5k | Pi Outpost |
| `edit` | 1 773 | ~0.4k | pi |
| `present_structure` | 1 535 | ~0.4k | Pi Outpost |
| `grep` | 1 107 | ~0.3k | pi |
| `read` | 824 | ~0.2k | pi |
| `powershell` | 734 | ~0.2k | pi |
| `bash` | 716 | ~0.2k | pi |
| `find` | 684 | ~0.2k | pi |
| `write` | 573 | ~0.1k | pi |
| `ls` | 538 | ~0.1k | pi |

**`work_plan` is 37% of the whole baseline** — on its own it is larger than everything pi
sends by default, and it is the reason the system prompt grows too: a tool's prompt
guidelines are appended to it. The four document extractors together cost about as much
as pi's entire toolset. Everything else is noise by comparison.

That is the shape of any optimisation worth doing: one tool's description, not the
distribution of fifteen.

## How the figures were produced

```bash
npx tsx server/scripts/probe-context-baseline.mts
```

It builds two real `AgentSession`s — pi's defaults, and pi-outpost's toolset on top —
then reads `session.systemPrompt` and `session.getAllTools()`, counting the JSON of each
tool's name, description, prompt guidelines and parameter schema. Reading the sources
instead would miss where a tool's guidelines actually land, which is in the prompt.

Tokens are **characters ÷ 4**. That is an order of magnitude, not a bill: the real count
depends on the tokenizer, and a JSON schema tokenizes worse than prose. It is accurate
enough to tell a 4k tool from a 0.2k one, which is the decision this page is for.

### What is not measured

- **Skills, extensions and project context files.** Discovery is off in the probe. A
  deployment that loads skills pays for them on top, and that cost belongs to the
  deployment rather than to the software.
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
