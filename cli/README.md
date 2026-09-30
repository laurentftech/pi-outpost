# pi-outpost

A web chat UI for the [pi coding agent](https://github.com/earendil-works/pi) — streaming replies, collapsible thinking, live tool cards (bash, edit, …), a file browser, git integration, and a conversation tree you can branch from.

```sh
npx pi-outpost init   # writes a starter pi-outpost.config.json here
npx pi-outpost        # http://127.0.0.1:3141/
```

Requires Node ≥ 24 and a model credential (`~/.pi/agent/auth.json`, a provider variable
like `ANTHROPIC_API_KEY`, or the setup screen). The default embedded runtime already carries
the [pi coding agent](https://github.com/earendil-works/pi); a separate `pi` executable is
needed only when `agentRuntime.mode` is `"rpc"`.

When extensions are enabled, the embedded runtime also loads Pi's built-in `codemode`,
`tool_search` and MCP extensions. Pi settings and MCP configuration decide which tools are active.

## It will not start without a configuration file

That is deliberate. The config decides the agent's working directory, which tools it gets, and whether it can write files or run bash — and inferring that from whatever directory you happen to be standing in is not a decision anyone wants made for them. `init` writes the safe version (read-only, no bash) for you to open up as needed.

## Configuration

The **first** of these that exists is read, and only that one — configurations are never merged, so the file you are reading is the configuration that is running:

1. `--config <path>`
2. `--profile <name>` → `<user config dir>/profiles/<name>.json`
3. `$PI_OUTPOST_CONFIG`
4. `$PI_OUTPOST_PROFILE` → `<user config dir>/profiles/<name>.json`
5. `./pi-outpost.config.json`
6. `<user config dir>/config.json`

`<user config dir>` is `$XDG_CONFIG_HOME/pi-outpost`, or `~/.config/pi-outpost`. Not sure which one won, or why a setting has the value it has? `pi-outpost config` prints the resolved configuration and the file it came from, without starting anything.

**Profiles** let you configure once and run anywhere: `pi-outpost --profile work` reads `~/.config/pi-outpost/profiles/work.json`, from any directory. A profile is an ordinary config file.

**Precedence**, for any setting that appears in more than one place: **flag > environment variable > config file > default**.

| Flag | Effect |
|------|--------|
| `--config <path>` | Configuration file to use |
| `--profile <name>` | Named profile from the user config directory |
| `--cwd <dir>` | Directory the agent works in |
| `--agent-dir <dir>` | pi config/session store (default `~/.pi/agent`) |
| `--port <n>` / `--host <addr>` | Where to listen (default `127.0.0.1:3141`) |
| `--offline` | Never fetch remote model catalogs |
| `--open` / `--no-open` | Whether to open the interface once listening |
| `--open-in window\|browser` | Open in a standalone window (default) or a browser tab |

Environment: `PI_OUTPOST_PORT` (falls back to `PORT`), `PI_OUTPOST_HOST`,
`PI_OUTPOST_CWD`, `PI_OUTPOST_AGENT_DIR`, `PI_OUTPOST_TOKEN`, `PI_OFFLINE`.

## Security

The agent has file and (optionally) bash tools. The server binds to `127.0.0.1` by default and validates the WebSocket `Origin`.

- There is **no `--token` flag** on purpose: a secret on the command line is readable by anyone who can list processes. Use `PI_OUTPOST_TOKEN` or the file's `server.token`.
- Binding off loopback (`--host 0.0.0.0`) **requires** a token — the server refuses to start otherwise, because the agent's tools would be reachable by anything that can route to the host.
- Sandbox the agent (`sandbox.root`, `allowWrite`, `allowBash`) for anything beyond your own machine. The effective sandbox is printed at every start.

Full documentation: [github.com/laurentftech/pi-outpost](https://github.com/laurentftech/pi-outpost#readme).

## License

MIT
