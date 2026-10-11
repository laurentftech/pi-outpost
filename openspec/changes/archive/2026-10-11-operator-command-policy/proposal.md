# Proposal

## Why

Issue #303. In a deployment shared by several people — embedded, kiosk, multi-user — an extension can
register slash commands meant for whoever operates it: reconfigure an integration's credentials,
change a capture level, loosen a permission policy. The operator wants the extension working in the
background and those commands out of the users' reach. Today the only ways are forking the extension
or not installing it.

## What Changes

- **`blockedCommands`** in the configuration file: globs over a command's name (`setup*`,
  `skill:internal-*`). A matching command is not offered in the composer's autocomplete, and a prompt
  that invokes it anyway is refused before anything runs — by the server, with a generic message that
  does not name the command, whether or not the command exists.
- **`allowedCommands`**: when set, the only commands offered and run. A message that merely begins
  with a slash and names no command the runtime has (`/tmp is full`) is still a message.
  `blockedCommands` wins over it.
- Matching ignores case and forgives a leading slash in the pattern. Patterns are checked at startup.
- Only the user's way in closes: the extension stays loaded, and its hooks, tools and other commands
  carry on. Both runtimes, since the check sits where the user's text enters the server.

## Capabilities

### New Capabilities

- `operator-command-policy`: the operator's control over which slash commands users see and run.

## Impact

- **`server/src/commandPolicy.ts`** (new): matching, offering, refusing.
- **`server/src/config.ts`**: the two keys, validated at startup.
- **`server/src/index.ts`**: the command list filtered where it is sent (snapshot, late-bound
  extensions); `prompt` and `edit_prompt` refused before anything else.
- **No client change**: the composer offers what the server sends.
- **Docs:** `README.md` (configuration keys), `docs/how-to.md` (Lock down a shared deployment),
  `pi-outpost.config.example.json`.
