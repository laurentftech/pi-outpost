# Scenario coverage

Scenario inventory: `rg '^#### Scenario:' openspec/changes/approve-project-mcp-servers/` (1 scenario).

| Scenario | Status | Evidence |
| --- | --- | --- |
| AProjectMcpServerDoesNotStartUntilAllowed | covered | `server/test/mcpApprovalWire.test.mjs`, "a project's MCP server does not start until allowed, then starts with the rebuilt session": a real server, the project's mcp.json defining a stdio server that writes a marker when started; `hello` asks about it (kind mcp, its command, the path of the configuration), ten seconds later the marker does not exist; allowed, the marker appears. `server/test/extensionApproval.test.ts`, "AProjectMcpServerDoesNotStartUntilAllowed: …": a stdio and an HTTP server are both undecided and left out of pi's MCP configuration; allowed, only that one is given to pi; its configuration changed, it is out even through the gate built before the change, and asked about again. |
