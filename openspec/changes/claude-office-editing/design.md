## Context and repository evidence

Requested intent: create DOCX/PPTX with Claude, retouch them visually, then let the agent continue from the saved file; maximize shared code with Open WebUI. Fidelity takes precedence over a lightweight editor.

The existing OpenSpec `openwebui-office-documents` contract covers creation, download and targeted changes, not live editing. `mcp-planning-app` describes a local, network-free planning extension, not Office tools.

Inspected implementation: `openwebui/src/office.ts` orchestrates the shared `office/` builders; `routes.ts` exposes creation, targeted updates and listings. `documents.ts` retains one copy per user/name, prunes by age/count and serializes selected updates; it has no document revision precondition. `embed.ts` embeds file bytes into a self-contained download card. `app.ts` requires the Open WebUI bearer and user identity before routes. `mcp/src/server.ts` exposes planning tools and a self-contained MCP Apps resource with no network domains; `mcp/src/config.ts` configures only the planning folder.

OpenLore MCP was unavailable and no local checkout/CLI was available; targeted GitHub inspection was used as allowed by AGENTS.md. Re-run orient on the implementation checkout before making changes. These observations inform the design; they do not imply that the existing offline planning contract can be widened silently.

## Decisions

### 1. Shared domain, thin host adapters

Keep OOXML builders in `office/`. Move host-neutral template discovery, creation, outlines and targeted update orchestration out of `openwebui/src/office.ts`. A common document module owns document identity, authorization inputs, immutable revisions, conflict rules, persistence and ONLYOFFICE sessions. Shared schemas/descriptions define common operation semantics; transport envelopes and host instructions remain adapter-specific.

A dedicated HTTP document service hosts that module for the NAS deployment. Claude's stdio adapter calls it with a configured service URL and a credential scoped to one principal. Open WebUI maps its verified identity to a namespaced principal and delegates to the same module/service. Never trust a model-supplied owner. Never merge identities based on matching display names or filenames; cross-client access to the same library requires an explicit administrator mapping.

### 2. Claude first, network capability separately declared

Add a separate Office MCP resource and tools for create document/presentation, list, read, targeted update, show/download and start editing. Reads return current revision, useful text/structure and editing status, not merely headings. Tools return a readable summary in text and structured content where supplied, so hosts choosing either still receive status and conflict instructions. Keep bearer credentials and editor tickets out of model-facing results.

The Office card obtains an editor launch capability through an app-only tool on an explicit user action. Use the MCP host's supported link-opening mechanism for the browser fallback. The hosted page is shared with Open WebUI. Inline hosting is enabled only after testing actual Claude Desktop behavior, the declared CSP frame/connect domains and ONLYOFFICE's frame/storage requirements. A blocked inline mode must offer the browser flow, never instruct users to disable sandboxing or certificate checks. Do not add Office domains to the planning resource.

Existing planning installs continue to run with no Office configuration. Extend bundle settings and naming/documentation without removing the required planning folder or breaking existing installs. Missing Office configuration yields setup instructions for Office tools, not a planning startup failure.

### 3. Revisioned authoritative bytes

Address documents by stable opaque ID and owner, not only filename. Each committed revision stores exact DOCX/PPTX bytes, checksum, parent revision, actor/source and timestamp. Rename does not change identity. A durable commit publishes bytes and metadata consistently; recovery after a crash must not point to a partial revision. All creation, replacement and import paths use the same concurrency rules.

Agent updates require `base_revision`. A per-document atomic transaction checks revision and editing state before publishing. The process-local promise queue alone is insufficient if the hosted adapters can run in separate processes. No silent same-name overwrite: collision requires an explicit revisioned replacement operation. Migration preserves old bytes and owners as revision 1 without rewriting the old embed snapshots.

Existing tool names and download responses remain available in Open WebUI. Update calls gain a revision requirement; list/read responses expose it and missing/stale revisions explain how to reread. This intentional safety change needs updated schemas, descriptions, docs and tests. Persistent libraries have no automatic age/count eviction; at configured quota, reject new writes with an actionable message. Existing limits remain for legacy download-only mode, documented separately.

### 4. One human editing session, serialized with agent changes

Baseline: one human editing session per document. State is ready -> editing -> saving -> ready; unresolved loss/failure becomes recovery-required. Acquisition and revision capture are atomic against agent writes. A document key binds ONLYOFFICE to the document and editing generation; it is shared within that session and rotated after closure, never randomly changed on each page load.

While editing, saving or recovery-required, agent reads are allowed and name the last committed revision and pending state; writes are refused. Closing the tab or clicking finish is not proof of persistence. Finish requests ONLYOFFICE persistence and waits for its confirmed save lifecycle. Force-save may produce an intermediate snapshot; it does not release the session by itself. Final validated bytes commit idempotently before release. A timeout does not unlock automatically; recovery either confirms a save or explicitly abandons pending edits after informing the user. Late callbacks from abandoned generations cannot overwrite newer revisions. Browser reconnection can resume the existing authorized session.

### 5. Network and credential boundaries

Configure a browser-visible HTTPS editor/service address and separately routable ONLYOFFICE/backend addresses. Browser must reach the hosted editor and ONLYOFFICE; ONLYOFFICE must reach the snapshot download/callback endpoints; backend must reach ONLYOFFICE's permitted save/download endpoints. These requirements apply equally over Tailscale. Do not mount the user's workspace into ONLYOFFICE.

Administrative/service credentials never enter HTML, model results or persisted chat cards. A short-lived, single-use launch ticket scoped to principal/document/session is redeemed into a secure editor session; URLs must be redacted from logs and removed after redemption, with no referrer leakage. Expired cards request a fresh launch capability instead of holding permanent access. Editor authentication is distinct from the existing Open WebUI tool bearer hook; callback/download endpoints have their own least-privilege authorization, not unauthenticated exceptions to that hook.

Enable ONLYOFFICE JWT with pinned algorithms and server-held keys. Verify callback JWT, session key and permitted lifecycle status before accepting content. Snapshot downloads grant access only to that session's captured document revision. Validate callback file URLs against configured ONLYOFFICE origins, schemes, ports and permitted paths; disable redirects or revalidate every hop, bound bytes/time, and prevent arbitrary internal/metadata access. Use an explicit deployment allowlist for the private ONLYOFFICE host, not a blanket private-network ban. Replays are idempotent; revoked/old generations are rejected. Validate OOXML structure, content type, archive expansion limits and document kind before committing.

### 6. Fidelity and agent editing limits

Keep original Office packages authoritative; never round-trip them through Markdown or HTML for visual editing or storage. Download the latest committed bytes exactly. Existing targeted builders can preserve untouched material but may rebuild an edited section/slide; make this limit visible before applying such changes. A requested text-only change that the tools cannot express without reconstructing layout must be refused or proposed as a new copy, rather than advertised as lossless. Broader layout-preserving OOXML operations are future work unless necessary for the selected acceptance fixtures.

Use licensed matching fonts on ONLYOFFICE. Approve real teacher-provided Word and PowerPoint fixtures: page/slide layout, images, tables, equations and speaker notes where present. Compare original Microsoft Office rendering with ONLYOFFICE and saved output reopened in Office; record supported cases and differences. Byte equality after an editor save is not a fidelity criterion because ONLYOFFICE can rewrite package parts. Untouched original revisions remain recoverable. Do not promise exact Microsoft Office parity.

## Delivery sequence

1. Probe actual Claude Desktop inline and external launch flows, including NAS/private-network routing and authentication. Record versions, results and the selected default.
2. Shared revision store and migration; shared orchestration; security/session lifecycle.
3. End-to-end Claude creation, edit, confirmed save, read and guarded agent update.
4. Switch Open WebUI to the same module/service and add the shared editor launch flow; preserve downloads.
5. Fidelity qualification, deployment docs and regression validation.

## Non-goals

Excel, simultaneous human co-editing, Microsoft Office/WOPI integration, arbitrary filesystem editing, automatic cross-account sharing, live cursor/selection feedback to the agent and a claim of perfect Office compatibility. Import of arbitrary pre-existing documents can be a later capability; migration covers files already retained by pi-outpost.

## Risks and decisions to verify

Claude iframe/CSP support and private-network access require the early probe; inline support is not assumed. ONLYOFFICE licensing/version and font licenses must be documented for the chosen deployment. The DS220+ is a deployment target to measure with representative files, not a promised performance level. Exact ONLYOFFICE status handling and force-save behavior must be derived from the pinned version's API and tested; do not implement from guessed status numbers.
