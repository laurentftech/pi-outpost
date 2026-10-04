# Design

## Context

**pi-outpost's skill:**
- `skills/structured-exchange/SKILL.md` is 15 kB and pi-oriented: profiles, files, `present_structure`.
- Its five reference pages total 23 kB:
  - `proposals.md`, host-neutral;
  - `graphs-and-tables.md`, one line naming `write_structure_figure`;
  - `enriched-contract.md`, one sentence pointing at `SKILL.md` for profiles;
  - `timelines.md`, one paragraph on `write_structure_table`, `compare_timelines` and
    `write_structure_figure`;
  - `figures.md`, which is about writing figure files: pi-only as a whole.
- `server/test/structuredExchangeDocumentedExamples.test.ts` already checks that the documented
  examples are valid.

**Open WebUI 0.11.4 skills**, read in its source:
- the `skill` table holds `name`, `description` and one `content` text;
- `/api/v1/skills/create` takes a `SkillForm`, and access goes through grants;
- with built-in tools on, every accessible skill is listed in `<available_skills>`, and `view_skill`
  loads one;
- a skill attached to a model, or mentioned with `$`, is injected in full;
- there is no environment variable and no import from a directory.

**pi-outpost's Open WebUI server:**
- a trust hook before every route;
- `openapi.ts`;
- `build:server` bundles `src/main.ts` with esbuild into `dist/server.mjs`;
- tests run from source with `tsx`.

## Goals / Non-Goals

**Goals:**
- Open WebUI's models can read the reference pages, with no step for the person deploying.
- One source: improving a page improves both hosts.
- The guide is read when it matters, from a refusal, not only "before writing".

**Non-Goals:**
- An Open WebUI skill.
- Rewriting `SKILL.md`.
- New guidance content.

## Decisions

### A tool, not an Open WebUI skill

| | Tool on pi-outpost's Open WebUI server | Open WebUI skill |
|---|---|---|
| Deployment step | none | admin creates it, then grants access, per deployment |
| Version | always the server's | the copy imported, drifts silently |
| Shape | one page per topic | one text per skill |
| Reachable from a refusal | yes, the refusal names the topic | only if the model thinks of `view_skill` |
| Works without Open WebUI's built-in tools | yes | only if attached to the model, then in full in every request |

Cost: one more tool schema (about 300 characters) in each request where the planning tools are on.
The skill manifest would cost about as much.

### Marked passages, one source

- **Markers:** in the source pages, pi-only passages sit between `<!-- only: pi-outpost -->` and
  `<!-- end -->` on their own lines.
- **Serving:** the server removes them, markers included. Nothing else is changed: no rewording, no
  templating.
- **What pi-outpost's agent sees:** the same text plus two comment lines, which carry no instruction.
- **`figures.md`** is about writing figure files, which Open WebUI has no tool for, so it is not
  served. The reader's own figure download in the embed needs no guide.
- **Rejected, moving the passages into `SKILL.md`:** weak models skip the references and read
  `SKILL.md`. Moving timeline-comparison guidance there would cost every pi-outpost request for one
  job.

### Pages copied at build time

- **How:** `build:server` copies the reference pages into `dist/guide/`, beside `dist/server.mjs`. The
  image copies `dist/guide` with the bundle.
- **From source** (tests, `npm start`), `guide.ts` reads the same files where the skill keeps them. It
  tries `dist/guide/` first, then `skills/structured-exchange/references/`.
- **Why not esbuild's text loader:** it was the first plan, but `tsx`, which runs the server from
  source, cannot import `.md`. Both paths would then have needed separate code.
- **What it means:** a page edited in `skills/` reaches the image at its next build. No copy is kept
  in `openwebui/`.

### Topics and hints

| Topic | Page | Refusal rules that point to it |
|---|---|---|
| `proposals` | `proposals.md` | target, ref, set, removals, change rules (`change-*`, `*-without-target`, `removal-*`) |
| `graphs-and-tables` | `graphs-and-tables.md` | a **table** with a target or removals (`kind-not-proposable`): a table reports a change through row roles, which this page teaches. Found live: pointed at `proposals`, the model retried a table proposal four times. |
| `timelines` | `timelines.md` | any issue on a `timeline` document, or a `timeline-*` rule |
| `enriched` | `enriched-contract.md` | version 2 fields: attributes, expectations, locations, artifacts, chapters, traceability, viewpoints |
| `graphs-and-tables` | `graphs-and-tables.md` | anything else |

The hint is computed from the refused document's kind and the issues' `rule` and `path`. It never
changes the issues. It adds a `guide` field to the refusal and a sentence to its `error`:
"read_structure_guide('proposals') explains this".

## Risks / Trade-offs

- **Weak models still may not read it.** That is why the refusal names the page: a model that just
  failed is the one most likely to follow a pointer. Checked live.
- **A marker forgotten around a new pi-only passage** would leak a pi tool name into Open WebUI. The
  test that no served page names a pi-only tool catches it.
- **A page grows.** Each read costs tokens once, in the turn that needs it, not in every request.

## Migration Plan

Additive. Embeds and plannings are unchanged.

## Open Questions

None.
