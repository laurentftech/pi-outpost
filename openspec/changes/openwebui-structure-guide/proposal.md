# Proposal

## Why

In pi-outpost, an agent learns structured exchange from three sources:
- the tool's description;
- the `structured-exchange` skill: `SKILL.md` plus five reference pages, 38 kB of worked examples
  and rules;
- the refusals.

In Open WebUI it has only the first and the last. `show_structure`'s description carries the
essentials and four examples. Live runs show that is enough for common graphs, sequences and
proposals, but not for the depth the reference pages hold: version 2 viewpoints and enriched
attributes, tables with chapters and row roles, traceability, the finer points of proposals and
timelines.

**Why not an Open WebUI skill.** Open WebUI 0.11.4 has skills, studied in its source:
- a skill is one text that an admin creates through the interface or the API and then grants
  access to;
- skills are listed to the model and loaded with `view_skill`.

Porting ours that way would need an admin step in every deployment, would merge or split the pages
into single texts, and would leave each imported copy to drift from the server's version.

## What Changes

- **A new tool on the planning server, `read_structure_guide(topic)`.** It returns the reference
  page for a topic (timelines, proposals, graphs and tables, the enriched version 2 contract,
  figures). With no topic it returns the list of topics and what each is for. The model reads the
  answer, which is text, not an embed.
- **One source for both hosts.** The pages served are the files of pi-outpost's skill
  (`skills/structured-exchange/references/*.md`), bundled with the server at build time. The few
  passages that concern only pi-outpost's tools (writing figure and table files, comparing timeline
  files) are marked in the source and left out when served. A page improved once improves both
  hosts.
- **Refusals point to the page that would have helped.** A refusal from `show_structure` names the
  guide topic matching the broken rule (a proposal rule points to `proposals`, a timeline rule to
  `timelines`), so the guide is read at the moment it is needed.
- **The descriptions say the guide exists:** `show_structure`'s, and `create_planning`'s for
  timelines. They say to read the topic before writing an unfamiliar kind.

Out of scope:
- Open WebUI skills. If a deployment wants one anyway, a later change can export the same pages as
  one.
- Changing what the pages teach, beyond marking the pi-only passages.

## Capabilities

### New Capabilities

- `openwebui-structure-guide`: the structured-exchange reference pages served to Open WebUI's models
  from the same source as pi-outpost's skill, and pointed to by refusals.

### Modified Capabilities

None at the requirement level. The skill's reference pages gain markers around pi-only passages.
What pi-outpost's agent reads is unchanged apart from those comment lines, and the existing check
that the documented examples are valid keeps holding.

## Impact

- **`openwebui/src`:** the guide route; topic hints in refusals; descriptions.
- **The build:** `build:server` (esbuild) bundles the reference pages as text.
- **`skills/structured-exchange/references/`:** markers around three pi-only passages.
- **Tests:**
  - server tests for the guide and the hints;
  - a test that what is served equals the source with the marked passages removed, and names no
    pi-only tool;
  - the image check;
  - one live run.
- **Docs:** `docs/openwebui.md` and `docs/openwebui-architecture.md`.
