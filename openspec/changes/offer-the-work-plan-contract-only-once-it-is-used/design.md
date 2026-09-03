## Why two tools rather than one gated tool

`AgentSession` builds its tool registry when the session is created. There is
`setActiveToolsByName(names)` — which rebuilds the system prompt, so an inactive tool is
not described — and nothing that registers a definition afterwards. One tool cannot
therefore have a small schema at rest and a complete one later: whatever is published for
a name is fixed for the session's life.

An earlier draft of this change worked around that with an *opener*: a tiny tool whose only
job was to create a plan and switch the full contract on. It works, and it makes the agent
pay a round trip on the turn it decided to plan, for operations — add a task, move a status
on — that are the whole point and cost almost nothing to publish.

Splitting by *what an operation carries* is better on both counts. The common path stays
published at all times, so nothing is discovered twice; what is withheld is the part that
is both expensive and unusable without a plan.

## Where the line falls

| | `work_plan` | `work_plan_extended` |
|---|---|---|
| Actions | `get`, `create`, `add_task`, `update_task`, `move_task`, `remove_task`, `clear` | `replace`, `set_dependencies`, `set_resources`, `set_evidence` |
| Carries | a title, a task tree of titles, descriptions, statuses and reasons | a complete normalized plan, evidence records, resource lists, dependency sets |
| Schema | 3 071 characters | 5 894 characters |
| Published | always | only while the session has a plan |

The rule that decides the line is not frequency but **prerequisite**: every operation in the
extended tool acts on a task that must already exist. `set_evidence` on no plan is not a
call anyone can make. A tool that cannot be called is a tool nobody needs to read.

That the four are also the least-used operations is what makes the split pay; that they are
impossible without a plan is what makes it *correct*.

## Evidence and resources leave the creation shape

They are the reason a creation task costs 1 009 characters twice over — once per nesting
level. Setting them at creation is possible today and rare: a task acquires evidence when
something has been run, which is not the moment the plan is drawn.

After this change they are set on a task that exists, through the tool whose schema already
describes them. `mutateWorkPlan` keeps accepting them in a creation draft — nothing stored
changes, and a plan written by an older client still normalises — but the schema stops
advertising them, which is where the cost was.

## When the extended tool becomes active

Derived from the persisted plan, never from a flag held beside it:

1. **A plan is created** — by `create` on the slim tool. The extended tool is activated
   before the call returns, so the agent's next call in the same turn can already record
   evidence.
2. **A session with a plan is bound** — restore, resume, switch, fork. `loadWorkPlan`
   already runs there.
3. **`clear`** puts the session back to publishing the slim tool alone, and a new session
   starts there.

## Two names, and what the agent makes of them

The risk of a split is a model that calls the wrong one, or hunts for an operation in the
tool that does not have it. Three things keep that in hand:

- The slim tool's description names the extended one and says what lives there.
- A refusal already names the field it refuses; an action that belongs to the other tool is
  refused by name, the same way.
- The extended tool is only ever published beside the slim one, never alone, so "the tool I
  know does not have this action" always has a visible answer.

This is the part no unit test settles. Task 5 drives a real model through opening a plan and
then recording evidence, and reads the transcript rather than the suite.

## Prompt-cache cost

Activating the extended tool changes the system prompt, which invalidates a provider's
prefix cache for that conversation — once, on the turn a plan is created. Conversations that
never open a plan save ~2.3k tokens on every turn. The trade is not close.
