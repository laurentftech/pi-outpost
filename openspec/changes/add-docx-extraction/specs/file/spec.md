## MODIFIED Requirements

### Requirement: CreateSandboxedTools

> Implementation: `createSandboxedTools` in `server/src/sandbox.ts` · confidence: reviewed

The system SHALL create a set of sandboxed tool definitions from a SandboxConfig: read/ls/grep/find,
PDF extraction and Word extraction confined to `root` (the read-only zone) plus the configured
read-only exception roots derived from skill, prompt, and extension locations; edit/write only when
`allowWrite` is true, further confined to `writableRoot` when set (the read-write zone) and never
extended by those exceptions; bash only when `allowBash` is true (bash cannot be path-scoped, so it
is an explicit opt-in). All roots and requested paths SHALL be checked after resolving symlinks.

Document extraction — PDF and Word alike — SHALL be a read tool: available whenever the read tools
are, denied wherever they are denied, and never gated behind `allowBash`.

#### Scenario: CreateToolsWithValidConfig
<!-- openlore-test: tags=smoke (auto) -->
- **GIVEN** A valid SandboxConfig
- **WHEN** createSandboxedTools is called
- **THEN** Returns an array of ToolDefinition objects matching the configured permissions

#### Scenario: ReadOnlyByDefault
<!-- openlore-test: tags=regression (auto) -->
- **GIVEN** A SandboxConfig with `allowWrite: false` and `allowBash: false`
- **WHEN** createSandboxedTools is called
- **THEN** The returned tools contain no edit, write, or bash tool
- **AND** The returned tools still contain the PDF and Word extraction tools

#### Scenario: ReadConfiguredResourceOutsideRoot
- **GIVEN** a skill, prompt, extension directory, or extension script configured outside `sandbox.root`
- **WHEN** a read, ls, grep, or find tool accesses a path inside that configured location
- **THEN** the read operation is allowed

#### Scenario: ExceptionDoesNotGrantWriteAccess
- **GIVEN** a configured read-only exception outside `sandbox.root` and sandbox writes enabled
- **WHEN** an edit or write tool targets a path inside that exception
- **THEN** the operation is denied because the path is outside the writable root

#### Scenario: UnrelatedPathRemainsDenied
- **GIVEN** one or more configured read-only exceptions
- **WHEN** a read tool targets a path outside both `sandbox.root` and every exception root, including a prefix look-alike
- **THEN** the operation is denied

#### Scenario: PdfExtractionIsPathConfined
- **GIVEN** a sandbox root
- **WHEN** the PDF extraction tool targets a path that resolves outside that root and outside every read exception
- **THEN** the operation is denied

#### Scenario: DocxExtractionIsPathConfined
- **GIVEN** a sandbox root
- **WHEN** the Word extraction tool targets a path that resolves outside that root and outside every read exception
- **THEN** the operation is denied
