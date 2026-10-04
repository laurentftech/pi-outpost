# Live run (task 3.3, 2026-10-04)

**Setup:** `openwebui/deploy/docker-compose.yml`, with Open WebUI v0.11.4 bound to `127.0.0.1`, the
image built from this branch, and `codestral-latest` with the planning tools attached. Requests were
written in French.

| Request | What the model did | Outcome |
|---|---|---|
| A delivery-drone requirements table "organised in chapters… with traceability to the parent requirement" | **No tool call.** It answered with a Markdown table in its reply. | Readable, but no chapters as headings and no traceability links. A model that can write a table in Markdown does not reach for a tool on its own. |
| "Affiche-le avec l'outil show_structure, avec les chapitres en titres et la traçabilité" | `show_structure`, a **version 1** table, with "Chapitre" and "Exigence Parente" as plain columns. **The guide was not read.** | Valid and drawn, but flat. Naming the tool was enough to use it, not to reach for the version 2 features. |
| "Propose une modification de ce tableau…" (first version of the hint) | A table proposal, refused (`kind-not-proposable`). It **read `read_structure_guide("proposals")` on its own**, as the refusal pointed it to, then retried three more times, still as a table proposal. It finally dropped the target and showed the whole table. | **The pointer works, but it pointed to the wrong page:** a table cannot be proposed. **Fix:** a table with a target or removals now points to `graphs-and-tables`, which teaches row roles. Spec scenario `ATableProposalPointsToRowRoles`. |
| "Lis d'abord le guide sur le contrat enrichi, puis refais le tableau en version 2…" | `read_structure_guide("enriched")` and `show_structure` **in the same step**, in parallel. | A version 2 table, but still flat: the page arrived after the document was already written. Reading in parallel defeats the purpose; the description says to read *before*, and the model did not wait. |
| After the fix, in a new chat: a 3-requirement table, then "propose: the second goes to priority Basse, remove the third" | A table proposal, refused. It **read `read_structure_guide("graphs-and-tables")`**, then showed the table with `role: "changed"` on E2 and `role: "removed"` on E3. | **Exactly the intended path:** refusal, then the right page, then a correct document, within one reply. |

## What it shows

- **Most useful:** the pointer in a refusal. The model followed it both times, unprompted.
- **Least useful:** the guide as something to read before writing. Codestral did not read it before
  writing, even when the request asked for features only the guide explains. When asked to read it
  first, it read it in parallel with writing.
- **Behaviours this change does not address:**
  - Codestral prefers Markdown for a table unless the tool is named;
  - it does not reach for version 2 features unprompted.

  Both are in what the model chooses to do, not in what it can learn.
