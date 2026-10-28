# Withheld tools stay withheld

## Why
After a long session on the embedded runtime, about half of the tools were published, Word and
Excel among them, in a conversation that had never named a document of either kind (#380). Each of
them is a schema sent with every request.

Editing a past message and navigating the conversation tree go through the SDK's
`AgentSession.navigateTree()`. That ends with `_restoreToolsFromTranscript()`, which activates every
registered tool the branch's recorded loadout never mentioned, as if it had just been registered.
The tools pi-outpost withholds are exactly the ones never mentioned, so the first rewind published
all seventeen. None of them was in the idle counts, so nothing ever withdrew them again.

## What Changes
- An on-demand tool (the document tools, the project model tool, the extended Work Plan tool) is
  published only while the server's idle counts track it. Every path in the server that publishes
  one already enrols it, so a published tool that is not tracked was published behind the server's
  back.
- The server reasserts that after each rewind (an edit, a tree navigation), before every prompt, and
  at the end of every turn. The last two catch any other way a tool gets switched on, from the SDK
  or an extension.
- A rewind keeps the tools the conversation is using, since their counts are kept.

## Impact
`server/src/index.ts` (`reassertOnDemandTools`, called from `navigateTree`, `editPrompt`,
`handlePrompt` and `ageDocumentTools`). No protocol change. The RPC runtime cannot change its
toolset and is unaffected. An extension can no longer keep one of these tools switched on by
itself.
