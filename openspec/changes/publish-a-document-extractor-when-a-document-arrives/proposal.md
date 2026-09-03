## Why

Four tool definitions — `pdf_extract`, `docx_extract`, `xlsx_extract`, `pptx_extract` —
come to **8 249 characters, ~2.1k tokens**, and they are sent on every request of every
conversation. On a resting baseline of ~7.8k tokens that is better than a quarter of the
floor, spent describing how to read Word, Excel, PowerPoint and PDF files to a session
that is refactoring TypeScript and will never open one.

Measured on 2026-09-03:

| Tool | chars | ~tokens |
|---|---|---|
| `xlsx_extract` | 2 345 | ~0.6k |
| `docx_extract` | 2 027 | ~0.5k |
| `pdf_extract` | 1 944 | ~0.5k |
| `pptx_extract` | 1 933 | ~0.5k |

The same reasoning that split the Work Plan contract applies, with one difference worth
being honest about: a Work Plan operation is *impossible* without a plan, whereas an
extractor is merely *useless* without a document. So the trigger cannot be a
prerequisite — it has to be the document itself arriving.

## What Changes

- An extractor is published when a document of its kind **enters the conversation**: a
  file attached through the composer, or a path to one named in the message being sent.
  Publication happens before the turn goes out, so the tool is there for the call that
  needs it.
- Once published, it stays for the rest of the session. A conversation that has handled
  one PDF will handle another.
- A session bound to a workspace publishes none of them until this happens. **Not** on the
  workspace merely containing such a file: a repository with a `docs/` folder would then
  pay for four tools while its agent refactors code, which is the case this change exists
  to stop.
- The four definitions are registered **last**, after every other tool. It changes nothing
  for a provider that does not cache prompts, and on one that does it keeps every
  definition ahead of them out of the invalidation.

## Capabilities

### New Capabilities

<!-- None. -->

### Modified Capabilities

- `agent`: what a session publishes becomes a function of what has entered the
  conversation, for the document extractors.

## Impact

- **Server** — `server/src/index.ts` (registration order, and the publication call on the
  prompt path), `server/src/workspace.ts` if the composer upload path lives there.
- **No wire change, no client change.** The composer already uploads a document into the
  workspace and attaches it as a path.
- **Expected** — a resting baseline of ~7.8k tokens down to **~5.7k** for a session that
  never touches a document.

## The cost this carries, stated

Publishing a tool mid-conversation changes the prompt prefix, and a provider that caches
prefixes must re-read everything from the changed point onward — the tools after it, the
system prompt, and the entire conversation so far.

- On the deployment this was measured against, the question does not arise:
  `mistral/devstral-medium-latest` reports `cacheRead: 0, cacheWrite: 0`. Nothing is
  cached, every turn pays for the whole prompt, and these 2.1k are pure loss on every turn
  that does not use them.
- On a provider that does cache, the trade is: a conversation that never touches a
  document saves the definitions outright; one that does pays a single invalidation whose
  size grows with the history behind it. It is a bet on how often documents appear, and
  for a code workspace that is rarely.

Registering the four last is what makes the bet cheaper without changing anything else.
