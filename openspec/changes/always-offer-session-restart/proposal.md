## Why
Users working on extensions and MCP need to restart the session without editing sandbox settings.

## What Changes
- Always offer Restart session in Settings, including widgets and servers without a sandbox.
- Reload resource code/configuration explicitly, then start a fresh agent session without writing settings.
- Keep Apply & restart session when a settings draft changed.
- Reject concurrent/busy or vetoed restarts with a visible reason.

## Capabilities
### Modified Capabilities
- persistent-runtime-settings: independent manual session restart.

## Impact
Settings UI, protocol, session factory and focused tests.
