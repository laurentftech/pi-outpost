# Scenario coverage

| OpenSpec scenario | Status | Evidence |
|---|---|---|
| `AUserSavesTouchUps` | covered | `openwebui/test/posters.test.ts` — `EmbedSavesTouchUpsAsAnOwnerScopedRevision`; `e2e/openwebui-posters.spec.ts` — `TheEditorAppearsInTheChat: saves a revision that the model reads` |
| `AStaleEmbedCannotOverwriteANewerRevision` | covered | `openwebui/test/posters.test.ts` — stale capability replay is refused at revision 2; `e2e/openwebui-posters.spec.ts` — `A stale embed cannot overwrite the saved version` |
| `TheEmbedDoesNotReceiveTheToolBearerSecret` | covered | `openwebui/test/posters.test.ts` — embed carries a scoped ticket and no bearer secret |
| `TheModelStartsFromTheSavedTouchUps` | covered | `openwebui/test/posters.test.ts` — latest read returns revision 2 and edited markup; `e2e/openwebui-posters.spec.ts` — tool readback after editor save |
| `ADifferentOriginCannotSave` | covered | `openwebui/test/posters.test.ts` — denied origin is unchanged; `e2e/openwebui-posters.spec.ts` — `A different browser origin cannot save through an embed capability` |
| `AMissingOrInvalidCapabilityCannotSave` | covered | `openwebui/test/posters.test.ts` — missing, malformed, mismatched poster/revision capabilities and invalid content are refused without a write |
