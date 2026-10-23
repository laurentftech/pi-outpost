# Edit Office documents from Claude with a shared ONLYOFFICE service

## Why

A teacher asks Claude to produce a worksheet or presentation, then needs to adjust its text and layout herself before asking for more changes. Downloading, editing and re-uploading breaks that workflow. Fidelity of DOCX and PPTX content and layout is essential, although ONLYOFFICE cannot promise identical rendering to Microsoft Office.

## What Changes

- Prioritize Claude Desktop: add Office tools and a document card to the existing stdio MCP extension, backed by a separately hosted document service and ONLYOFFICE Docs.
- Extract reusable Office orchestration from the Open WebUI adapter into a shared package; keep the existing `office/` builders. Share storage, revisions, update rules, editor sessions and save handling across both adapters.
- Store immutable document revisions; require the revision read by the agent for writes and exclude agent mutations during human editing or unresolved saves.
- Open the same hosted editor in the MCP App when verified compatible, otherwise through an explicit browser action. Prove Claude compatibility before committing to inline editing.
- Route existing Open WebUI document operations through the shared implementation, preserving their download responses. Add editing access to the same service without a second editor implementation.
- Preserve existing planning behavior and its offline MCP resource. Office support is optional and does not require ONLYOFFICE for existing document downloads.

- Include the native pi-outpost web app: render Word pages and PowerPoint slides in the file viewer and open the shared ONLYOFFICE editor in place. Native support is required for completion, with Claude still the first delivery.

## Impact

New capabilities: `shared-office-documents`, `mcp-office-app`, `pi-outpost-office-viewer`. Extend `openwebui-office-documents`.
Likely implementation surface: `office/`, `apps-core/` or a new document package, `mcp/src/`, `mcp/viewer/`, `mcp/manifest.json`, `openwebui/src/{office,documents,routes,app,trust,embed,openapi}.ts`, the download card, deployment and user documentation.

The hosted editor introduces browser-to-service and service-to-ONLYOFFICE traffic absent from today's Open WebUI architecture. It requires scoped credentials, explicit network configuration and a new security review. Existing kept documents need migration into revisioned storage; their current expiration policy cannot silently apply to persistent teaching materials.

No implementation, deployment or publishing is included in this proposal. First delivery is an end-to-end Claude flow; Open WebUI reuse is part of the same design and completion criteria.

## Open-source-only constraint

All required rendering, editing and agent capabilities SHALL use open-source components and APIs available without paid entitlement. ONLYOFFICE Docs Community is the target edition. Exclude Automation API/createConnector, Developer/Enterprise-only methods, trials, commercial add-ons and subscription-dependent features. Unsupported operations must fail clearly or use a verified open-source implementation; a paid fallback is not acceptable. Preserve pi-outpost's MIT licensing intent; do not assume that public source or a separate container resolves AGPL obligations.
