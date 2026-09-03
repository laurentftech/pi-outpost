# Pi Outpost next to pi and opencode

Measured on **2026-09-03**, against **pi-outpost 0.20.1** and the **pi SDK 0.84.4** it
bundles. Figures for pi and pi-outpost come from the probe described below and are
reproducible; the opencode column is compiled from its public documentation and is
**not measured here** — see [What is not measured](#what-is-not-measured).

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
| Pi Outpost, default configuration | ~1.9k tokens | 15 tools, ~8.8k | **~10.7k tokens** |
| opencode | not measured | not measured | not measured |

Per tool, largest first — this is where the difference actually is:

| Tool | chars | ~tokens | |
|---|---|---|---|
| `work_plan` | 16 160 | ~4.0k | Pi Outpost |
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
- **opencode.** It is not installed on the machine these numbers come from, and an
  invented figure for someone else's software would be worth less than an empty cell.
  Its default toolset is comparable in count and its prompt is of the same family, so the
  honest way to fill that row is to run the equivalent probe against it.
