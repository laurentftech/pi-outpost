## 1. Compatibility and design evidence
- [ ] Run OpenLore orient in the implementation checkout; reconcile shared-package boundaries with current specs and source.
- [ ] Pin ONLYOFFICE Docs Community version; document licensing, lifecycle statuses and required network routes.
- [ ] Probe actual Claude Desktop inline editor, CSP, frame/storage behavior, link opening and browser fallback; record host versions and decide default.

## 2. Shared service and persistence
- [ ] Extract host-neutral Office orchestration, schemas and descriptions; keep OOXML builders shared.
- [ ] Implement authenticated principals and explicit cross-adapter mappings.
- [ ] Implement immutable revisions, atomic commits, checksums, read APIs, revision preconditions and collision handling across processes.
- [ ] Migrate existing kept documents without rewriting bytes; define persistent quotas, backups and retention separately from legacy temporary mode.

## 3. ONLYOFFICE lifecycle and security
- [ ] Implement editor sessions, snapshot downloads, document keys and confirmed final-save lifecycle.
- [ ] Implement editing/saving/recovery exclusion, reconnection, informed abandonment and rejection of stale generations.
- [ ] Implement scoped single-use launch tickets and browser sessions without credentials in chat/model payloads.
- [ ] Verify JWT/session binding, replay handling, outbound URL/redirect constraints, file/archive limits and package validation.

## 4. Claude first
- [ ] Add Office service settings and tools to the stdio adapter and MCP bundle; preserve existing planning configuration.
- [ ] Add Office MCP App card, app-only launch, download, accurate status and browser fallback; isolate Office CSP from planning resources.
- [ ] Exercise Claude creation of Word and PowerPoint, manual editing, confirmed saving and a guarded agent update in the running integration.

## 5. Open WebUI reuse
- [ ] Route document operations through the shared core/service; preserve existing names and download envelopes.
- [ ] Add read/revision/status information, require base_revision for updates and update tool guidance.
- [ ] Add the shared editor action while preserving the existing tool authentication boundary and download-only mode.

## 6. Qualification and documentation
- [ ] Obtain representative teacher fixtures; qualify Word and PowerPoint fidelity, matching fonts and reopening in Microsoft Office.
- [ ] Explain layout-rebuilding agent operations; refuse unsupported lossless requests or offer a separate copy.
- [ ] Test cross-process races, save failure/recovery, callback replay, unauthorized access and migration/restart behavior.
- [ ] Exercise UI happy paths and disruptive interactions with Playwright in running integrations; include stale cards, double clicks, disconnects and failed saves.
- [ ] Record actual Claude Desktop compatibility separately from the MCP test host; record DS220+ observations without promising capacity.
- [ ] Update README, Claude and Open WebUI guides, architecture/security docs, bundle configuration and NAS deployment examples.
- [ ] Complete scenario-to-test matrix by reading assertions; run focused tests, relevant suites, strict OpenSpec validation and bundle validation.

## 7. Native pi-outpost (required for completion)
- [ ] Add DOCX/PPTX binary routing to FileViewer with shared rendered page/slide preview, navigation, zoom and enlarge.
- [ ] Register existing workspace Office files with stable shared identities and project-scoped access, without mounting the workspace into ONLYOFFICE.
- [ ] Embed the shared editor for writable files; enforce read-only mode and permission revocation server-side.
- [ ] Coordinate native agent writes and human sessions; add external content-hash conflicts and recoverable workspace/revision publication.
- [ ] Refresh preview and agent reads after confirmed saves; prevent stale views/callbacks across project switches.
- [ ] Test native running-app rendering/editing, read-only boundaries, unavailable service, external edits, crash recovery and disruptive UI transitions with Playwright.
- [ ] Update native usage/configuration documentation and scenario coverage; retain Claude as the first delivery while requiring all three adapters for completion.

## 8. Open-source-only release gate
- [ ] Inventory all integration APIs, plugin methods, runtime helpers, fonts and assets with exact versions, upstream licenses and notices; exclude paid-only methods and incompatible dependencies.
- [ ] Verify AGPL integration/distribution obligations while preserving the intended MIT boundary; record unresolved restrictions instead of silently relicensing.
- [ ] Prove rendering, manual editing, saves and supported agent operations on a clean Community installation with no paid entitlement or trial.
- [ ] Assert no Automation API/createConnector, commercial license activation or subscription service is required; reject unsupported operations clearly.
