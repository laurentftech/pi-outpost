## The constraint that shapes everything

`AgentSession` builds its tool registry when the session is created. There is
`setActiveToolsByName(names)` — which rebuilds the system prompt, so an inactive tool is
not described — and `getAllTools()`, and nothing that registers a definition afterwards.

So "publish a small `work_plan` at rest and a complete one once there is a plan" cannot be
one tool with two schemas. Both definitions exist from the start, and only their active
flag changes. Two definitions mean two names, which is the whole design question: what does
the agent see when there is no plan?

## What the resting state offers

**An opener, not a smaller `work_plan`.** One tool, `start_work_plan`, whose parameters are
a title and nothing else, and whose description says when to reach for it — the same
sentence the system prompt spends on the subject today. Roughly 300 characters against
12 480.

The alternatives considered:

*Nothing at all, and a line in the prompt.* Cheapest, and it does not work: an agent cannot
call what is not published, so the plan would only ever be opened by a human asking for
one. The capability exists precisely for the moments the agent notices the work is
non-trivial.

*A create-only `work_plan`, renamed to something else once complete.* The name would change
under the agent mid-conversation, with the earlier name still in the transcript. Names are
how a model addresses a tool; changing one is worse than adding one.

*The full contract, always, and accept the cost.* What we do today, and what this change
exists to stop.

The opener is the pattern opencode uses for skills: a small always-present tool that brings
the large thing into scope on demand. The cost is one extra round trip, on the turn where
the agent has already decided it is doing something substantial.

## When the full contract becomes active

Three moments, all server-side, none requiring the agent to ask twice:

1. **The opener runs.** It creates the plan and activates `work_plan` before returning, so
   the agent's next call in the same turn can already use `set_status` or `add_task`.
2. **A session with a plan is bound.** Restore, resume, switch, fork: `loadWorkPlan` already
   runs there, and a session that has a plan starts with the contract active. An agent
   resuming work never sees the opener.
3. **Never otherwise.** `clear` puts the session back to resting, and a new session starts
   there.

The state is derived from the persisted plan, not from a flag someone has to remember to
set — the same rule the review state already follows.

## What this does not do

**It does not shrink the contract.** `work_plan` is 12 480 characters and its shape is a
separate problem: the `plan` and `task` properties each serialise a complete task tree, the
evidence record appears five times, and eleven actions share one flat object. Gating hides
that cost from conversations that never open a plan; it does nothing for the ones that do.
Both are worth doing and they are independent.

**It does not reach the RPC runtime.** That dialect has no command for the active toolset,
so an RPC child publishes the full contract at all times. Stated in the capability, and
consistent with the embedded SDK runtime being the supported target.

## Why this is not a prompt-cache regression

Changing the active toolset mid-session changes the system prompt, which invalidates a
provider's prefix cache for that conversation — once, on the turn a plan is opened. A
conversation that opens a plan pays one cache miss; a conversation that never opens one
saves ~3k tokens on every turn. The trade is not close.
