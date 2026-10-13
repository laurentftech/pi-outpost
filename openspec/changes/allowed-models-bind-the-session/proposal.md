# Proposal

## Why

`allowedModels` restricted what the model switcher offered, and nothing else. A session starts on
the agent directory's default model (`settings.json`), and a new session starts from it again: a
deployment restricted to one model answered with the user's default until someone opened the
switcher. Found live, with `allowedModels` naming Codestral and every new session answering with
the user's OpenRouter default. And `set_model` accepted any model a client named over the WebSocket,
so the restriction held only for clients that played along.

## What Changes

- A session on a model outside `allowedModels` is moved to the first allowed model — at start, after
  every session replacement (new, switched, forked), and before every turn. For that session only:
  the agent directory's default is left alone.
- `set_model` naming a model outside the list is refused with an error, and nothing changes.
- When no allowed model can be set (no credentials), the start still succeeds (reported as before
  by the credential status), and a turn is refused with an error rather than run on an excluded
  model.

## Capabilities

### Modified Capabilities

- `model`: `AllowedModelsBindTheSession` is added.

## Impact

- `server/src/index.ts`.
- No configuration or protocol change; clients already receive `error` and the snapshot's `model`.
