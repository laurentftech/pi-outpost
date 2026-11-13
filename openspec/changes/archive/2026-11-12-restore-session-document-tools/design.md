# Design
Replay messages on the selected branch rather than scanning all session entries or workspace files. Tool calls reset the corresponding counter; completed or aborted assistant turns age tools not used during that turn. Mentions reset publication, but unused guesses are not restored. Ignore compaction entries without dropping older branch calls. Empty branches restore no tools.

The embedded SDK keeps provider-visible declarations in transcript system messages and executable wrappers in each request context. Capture the latter through the public prepareRequest hook, retaining the preceding hook. When execution starts for a known deferred tool that the SDK lists callable, publish it and add its registered SDK wrapper to that execution snapshot. This happens after the model request, preserving narrow declarations and all SDK validation and extension hooks. No new tool implementation or unconfined fallback is created.

The counters are derived state, not a second persisted sidecar. RPC cannot change publication and retains its current search path.
