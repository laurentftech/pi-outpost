## Context
User intent is a manual restart for extension/MCP development. OpenLore orient identified SettingsMenu and index.ts; graph unavailable so targeted rg found that the current button requires sandboxChanged and update_config ignores empty changes. Existing specs require persistence only for settings changes, not independent reloads.

## Decisions
Add restart_session, separate from update_config and restart_server. No configuration persistence occurs. Rebuild through the existing runtime factory with explicit resource-loader reload because new-session creation alone reuses cached extension factories (reproduced by the extension test). The operation creates a fresh conversation, like the existing Apply & restart behavior; the UI says so. MCP built-in extension is reconstructed and rereads mcp.json. Reuse settings progress/error/ack handling. Refuse busy/concurrent operations and extension vetoes. RPC runtimes without rebuildTools report unsupported instead of claiming a reload.
