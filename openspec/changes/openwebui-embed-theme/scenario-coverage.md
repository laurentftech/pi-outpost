# Scenario coverage

| Scenario | Status | Test |
|---|---|---|
| `DarkOpenWebUIOnALightSystem` | covered | `e2e/openwebui-embed.spec.ts` — `Planning theme follows Open WebUI when readable, otherwise follows the system`; `e2e/openwebui-posters.spec.ts` — `Poster theme follows Open WebUI when readable and preserves poster colours` |
| `LightOpenWebUIOnADarkSystem` | covered | `e2e/openwebui-embed.spec.ts` — `Planning theme follows Open WebUI when readable, otherwise follows the system` |
| `TheUserSwitchesOpenWebUIsTheme` | covered | `e2e/openwebui-posters.spec.ts` — `Poster theme follows Open WebUI when readable and preserves poster colours` |
| `TheSystemSwitchesWhileOpen` | covered | `e2e/openwebui-embed.spec.ts` — `Planning theme follows Open WebUI when readable, otherwise follows the system` |
| `TheDefaultFrameFollowsTheSystem` | covered | `e2e/openwebui-embed.spec.ts` — `Download card follows the system in Open WebUI's opaque default frame` |
| `SaveIsAvailableOnlyForUnsavedChanges` | covered | `e2e/poster-files.spec.ts` — `APosterFileOpensInTheEditor and TouchUpsReachTheAgent: drawn in the editor, a correction saved reaches the file` |

The jsdom unit tests in `openwebui/test/hostTheme.test.ts` also cover readable light/dark parents, live class changes, opaque-parent fallback, system changes and cleanup.

The live Open WebUI 0.12.3 check is complete: with same-origin enabled, the planning and poster themes follow Open WebUI's theme changes.
