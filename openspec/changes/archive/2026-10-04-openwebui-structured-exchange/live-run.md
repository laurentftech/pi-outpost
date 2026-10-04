# Live run (task 3.2, 2026-10-04)

**Setup:** `openwebui/deploy/docker-compose.yml`, run as written, with:
- Open WebUI v0.11.4, bound to `127.0.0.1`;
- the image built from this branch;
- `codestral-latest`, with the planning tools attached to the model;
- requests written in French.

## What the model did

| Request | Tool calls | Result |
|---|---|---|
| "Dessine-moi le processus de traitement d'une commande en ligne…" (five actors) | `show_structure`, a **sequence** | Drawn: 5 participants, 5 messages, labels in French. A sequence is a fair reading of "a process between actors". |
| "Un graphe d'architecture : Frontend, API, Base de données, Cache…" | `show_structure`, a graph | Drawn: 4 elements, 3 relationships. |
| "Propose de remplacer le Cache par Redis et d'ajouter une file de messages…" (first wording of the refusal) | `show_structure`, a proposal whose relationship started from `api`, which the proposal did not declare | **Refused** (`unresolved-endpoint`). The model **did not retry**: it told the user "Veuillez corriger cela et réessayer". It read the refusal as a message to relay. |
| Same request, after the two fixes below | `show_structure`, a valid proposal on the first call | Drawn: `Cache` removed, `Redis` and `File de messages` added, `API` and `Base de données` as context (`ref`, no `set`). |
| "Le Frontend lit directement Redis" (meant to make it forget an endpoint) | `show_structure`, a valid proposal: `Frontend` and `Redis` declared as context | Drawn. |
| "Trois modules… ne mets aucun type sur les relations" (meant to break the contract) | `show_structure` with untyped relationships, **refused**; then at once `show_structure` again with `kind: "depends"` | Drawn. The model **corrected itself within the reply** and said nothing about the refusal. |

## Fixes made from it

1. **The refusal speaks to the model.** "This message is for you, not for the user: correct the
   document using the issues below and call show_structure again now, in this same reply." The
   description also says "correct the document yourself… never ask the user to fix it".
2. **The proposal rule the model broke is in the description.** "Every element a relationship touches
   must be in `nodes`: an existing one as context, with its `ref` and its label and no `set`."
3. Found by `EveryExampleIsShown`, before any live run: the first graph example was itself invalid. A
   new relationship needs a `kind`. The examples were fixed, and the description now says so.

## Destructive pass (straight at the container)

| Input | Outcome |
|---|---|
| A JSON string with trailing text | 422, `not-json` |
| A proposal with a target, a removal and no element | 422 from the contract (a graph holds at least one element) |
| A change on an element with no `ref` | 422 |
| A table with a `target` | 422 (a table cannot be proposed) |
| An unknown kind (`mindmap`) | 422 |
| A number as the document | 422 |
| A 4.5 MB label | 422 from the contract, which names its ceiling; never a bare HTTP 413 |
| Labels `R&D </script><script>…`, `&quot;`, a kind `x&y` | Shown. The page holds no `&` and a single `<script>`. |
| 30 concurrent shows | 30 × 200, 57 ms in total |

**Files written under `/data` during all of it: none.**
