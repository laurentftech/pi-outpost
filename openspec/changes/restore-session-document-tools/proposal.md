# Restore document tools when resuming a session

## Why
A resumed conversation remembers a PowerPoint extraction but loses the published tool and its idle counter. Repeating a remembered call can also fail because deferred tools are callable by other tools but absent from the direct-call execution snapshot.

## What Changes
- Reconstruct recently used deferred tools and their inactivity counters from the selected branch, including pre-compaction entries.
- Resolve explicit calls to registered callable deferred tools at execution time without declaring every schema.
- Keep argument validation, extension hooks, sandbox checks and unknown-tool errors.

## Impact
Embedded runtime and document-tool publication; documentation and unit, wire and running-app regression tests. RPC's existing deferred-tool search remains unchanged.
