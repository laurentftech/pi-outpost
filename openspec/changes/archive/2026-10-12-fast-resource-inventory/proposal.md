# Proposal

## Why

Colleagues found pi-outpost slow to start; `npm run dev` here took ~20 s. Measured: ~11 s of it was the
Agent resources inventory, which startup awaited before answering. It asked git where the repository
was once per loaded skill or extension — repository or not — one process at a time (~0.1 s each on a
Mac, more on Windows), and ran twice at boot.

## What Changes

- **The inventory asks git once per repository**: the repository of a resource is found by walking up
  to a `.git` entry; git confirms it once per candidate, and is not asked at all where there is no
  `.git`. Repositories are inspected in parallel, in order.
- **Starting a project waits at most one second for its inventory.** Past that, the session starts and
  the inventory is sent to the project's clients when it lands (`agent_resource_inventory`, which the
  client already handles).

## Capabilities

### Modified Capabilities

- `agent-resource-management`: `AResourceInventoryDoesNotHoldStartup` and
  `TheInventoryAsksGitOncePerRepository` are added.

## Impact

- `server/src/resourceRepositories.ts`, `server/src/index.ts`. No client change.
- Measured on `npm run dev` with this machine's extensions and skills: `/health` at 12.0 s instead of
  31.2 s in the same conditions; runtime ready to session ready 0.3 s instead of ~13 s.
