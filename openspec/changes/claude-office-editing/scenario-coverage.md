# Scenario coverage plan

Specification only: implementation and tests have not been added. Every scenario is currently **uncovered**. Planned targets below are implementation work, not evidence of passing coverage.

| Capability | Scenario | Status | Planned test boundary |
|---|---|---|---|
| shared-office-documents | BothAdaptersUseTheSameCore | uncovered | shared service integration/security tests |
| shared-office-documents | OwnersAreNotChosenByTheModel | uncovered | shared service integration/security tests |
| shared-office-documents | LibrariesAreLinkedOnlyExplicitly | uncovered | shared service integration/security tests |
| shared-office-documents | ARevisionPreservesExactBytes | uncovered | shared service integration/security tests |
| shared-office-documents | AStaleWriteChangesNothing | uncovered | shared service integration/security tests |
| shared-office-documents | ANameCollisionDoesNotOverwrite | uncovered | shared service integration/security tests |
| shared-office-documents | ACrashCannotPublishAPartialRevision | uncovered | shared service integration/security tests |
| shared-office-documents | ExistingDocumentsMigrateWithoutLoss | uncovered | shared service integration/security tests |
| shared-office-documents | QuotaDoesNotDeleteTeachingMaterials | uncovered | shared service integration/security tests |
| shared-office-documents | AnEditorAndAnAgentCannotBothAcquireTheDocument | uncovered | shared service integration/security tests |
| shared-office-documents | AgentWritesWaitForHumanSave | uncovered | shared service integration/security tests |
| shared-office-documents | ClosingATabDoesNotMeanSaved | uncovered | shared service integration/security tests |
| shared-office-documents | AFailedSaveRequiresRecovery | uncovered | shared service integration/security tests |
| shared-office-documents | AnIntermediateSaveDoesNotReleaseTheSession | uncovered | shared service integration/security tests |
| shared-office-documents | TheFinalSaveReleasesOnlyAfterCommit | uncovered | shared service integration/security tests |
| shared-office-documents | AnAbandonedGenerationCannotWriteLater | uncovered | shared service integration/security tests |
| shared-office-documents | ALaunchTicketCannotBeReusedOrTransferred | uncovered | shared service integration/security tests |
| shared-office-documents | SecretsDoNotReachTheConversation | uncovered | shared service integration/security tests |
| shared-office-documents | ACallbackMustBelongToTheSession | uncovered | shared service integration/security tests |
| shared-office-documents | ACallbackCannotFetchArbitraryURLs | uncovered | shared service integration/security tests |
| shared-office-documents | InvalidSavedPackagesAreRefused | uncovered | shared service integration/security tests |
| shared-office-documents | DuplicateCallbacksAreIdempotent | uncovered | shared service integration/security tests |
| shared-office-documents | AVisualEditKeepsAnOfficePackage | uncovered | shared service integration/security tests |
| shared-office-documents | ALayoutRebuildingChangeIsNotCalledLossless | uncovered | shared service integration/security tests |
| shared-office-documents | RepresentativeFilesAreQualified | uncovered | shared service integration/security tests |
| mcp-office-app | ClaudeCreatesBothOfficeKinds | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | ClaudeContinuesFromHumanChanges | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | EitherResultChannelExplainsStatus | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | TheUserOpensTheEditor | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | ABlockedInlineEditorHasABrowserPath | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | AnOldCardRequestsFreshAccess | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | SaveStatusReflectsPersistence | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | AnExistingInstallStillWorks | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | PlanningRemainsOffline | uncovered | MCP stdio + running host/Playwright |
| mcp-office-app | ThePackagedOfficeClientWorks | uncovered | MCP stdio + running host/Playwright |
| openwebui-office-documents | ExistingDownloadsRemainAvailable | uncovered | Open WebUI HTTP + running embed/Playwright |
| openwebui-office-documents | AnUpdateNeedsTheRevisionRead | uncovered | Open WebUI HTTP + running embed/Playwright |
| openwebui-office-documents | TheCardUsesTheSameEditor | uncovered | Open WebUI HTTP + running embed/Playwright |
| openwebui-office-documents | TheToolBoundaryStillRejectsUnsignedCalls | uncovered | Open WebUI HTTP + running embed/Playwright |
| openwebui-office-documents | OnlyExplicitlyLinkedClientsShareDocuments | uncovered | Open WebUI HTTP + running embed/Playwright |
| openwebui-office-documents | DownloadOnlyDeploymentsDoNotRequireAnEditor | uncovered | Open WebUI HTTP + running embed/Playwright |

At implementation time, replace planned boundaries with exact test files and titles, inspect assertions, and include all affected existing scenarios from `mcp-planning-app` and `openwebui-office-documents`. Fidelity qualification also needs recorded real Office rendering comparisons; a fake editor or screenshot alone is insufficient.

## Native pi-outpost addition

| Capability | Scenario | Status | Planned test boundary |
|---|---|---|---|
| pi-outpost-office-viewer | WordOpensAsRenderedPages | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | PowerPointOpensAsRenderedSlides | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | PreviewDoesNotLockTheDocument | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | NativeEditingUsesTheSharedSession | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | ReadOnlyCannotSave | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | SaveUpdatesTheWorkspaceAndAgentRead | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | AnExternalEditIsNotOverwritten | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | WorkspaceAccessCannotEscapeTheProject | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | ProjectSwitchDoesNotLeakTheOldDocument | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | UnavailableRenderingIsExplicit | uncovered | native server integration + running app/Playwright |
| pi-outpost-office-viewer | InterruptedWorkspacePublicationRecovers | uncovered | native server integration + running app/Playwright |
