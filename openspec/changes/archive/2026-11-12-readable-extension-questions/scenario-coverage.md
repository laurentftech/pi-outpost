# Scenario coverage

| Scenario | Status | Test and assertions |
| --- | --- | --- |
| ReadConversationWhileAnswering | covered | `e2e/extension-questions.spec.ts`, "read and scroll the conversation while a question is pending, then answer by keyboard": real server and extension, non-overlapping bounds, wheel scrolling, click/text selection without answering, keyboard choice and extension's returned value. |
| LongQuestionsLeaveMobileContextReadable | covered | `e2e/extension-questions.spec.ts`, "a long mobile question scrolls independently and survives resizing and context clicks": mobile and resized bounds, independent scrolling, no horizontal overflow and last choice received by the extension. |
| SuccessiveQuestionsPreserveDraftAndIsolateAnswers | covered | `e2e/extension-questions.spec.ts`, "successive questions reset answers, preserve the composer draft, and allow explicit refusal": empty second input, editor prefill, reset checkboxes, individual response values, refusal and unchanged composer draft. |
| RespondToExtensionDialog (components main spec) | covered | `ui/src/components/ExtensionDialog.test.tsx`: select, confirm, input, editor, cancellation and timeout callbacks; `e2e/extension-questions.spec.ts`: real extension receives sequential answers and explicit refusal. |
