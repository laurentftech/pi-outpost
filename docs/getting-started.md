# Getting started

[Home](../README.md) · [How-to](how-to.md)

- [Start in 5 minutes](#start-in-5-minutes)

## Start in 5 minutes

You need Node ≥ 24 (what the pi SDK itself requires) and either an API key or an account
login supported by a model provider. You do *not* need
[pi](https://github.com/earendil-works/pi) installed — its SDK is bundled here.

**1. Go to the project you want to work on.** The configuration is written here, and the
agent starts out confined to this directory.

```bash
cd ~/projects/my-app
```

**2. Write a starter configuration.**

```bash
npx pi-outpost init
```

That gives the agent this directory to read and write, and a shell confined by this
machine's sandbox runner — refused, never unconfined, where none can confine it (see
[the default sandbox](sandboxing.md#the-default)).

**3. Start it.**

```bash
npx pi-outpost
```

It serves on `http://127.0.0.1:3141/` and opens the interface in a window of its own — no
tabs, no address bar. `--open-in browser` puts it in a normal browser tab, `--no-open`
leaves it closed.

**4. Give it a model.** With no credentials, the interface asks for them instead of showing
a chat that could only fail: pick a provider and sign in or paste an API key, or declare an
OpenAI-compatible endpoint of your own — a corporate gateway, vLLM, Ollama, LM Studio.
Nothing to restart; the chat works as soon as you save.

**5. Ask it something.** "What does this project do?" is a good first turn — it can read
everything under this directory, and you will see it search and open files as it goes.

Then, when you want it to actually change things, open `pi-outpost.config.json` and widen
the sandbox — or do it from the gear menu, which applies immediately and writes the same
file:

```json
{
  "cwd": ".",
  "sandbox": { "root": ".", "allowWrite": true, "writableRoot": "./src", "allowBash": false }
}
```

**No Node, no npm?** Each release carries a single executable per platform under
[Releases](https://github.com/laurentftech/pi-outpost/releases), server and interface
inside. On macOS and Linux, `chmod +x` it first — a release download carries no execute
bit. Unsigned, so macOS blocks a fresh download outright and Windows SmartScreen warns on
first launch — both clear in a step; see [docs/sea-packaging.md](sea-packaging.md), which
also covers building one yourself with `npx pi-outpost build-exe`.

### Why it insists on a configuration file

pi-outpost never starts without one: the agent's working directory, its tools and its
sandbox are decided there, and guessing them from whatever directory you happen to be
standing in is not a decision anyone wants made for them. `init` writes the default sandbox
out, so you can see it and change it:

```json
{
  "cwd": ".",
  "agentRuntime": { "mode": "embedded" },
  "sandbox": { "root": ".", "allowWrite": true, "allowBash": true, "bashRunner": "auto" },
  "server": { "port": 3141, "host": "127.0.0.1" },
  "branding": { "title": "π" }
}
```

Not sure which file is in force, or why a setting has the value it has? **`pi-outpost
config`** prints the resolved configuration and the file it came from, without starting
anything.

> **Security note.** The server binds to `127.0.0.1` and validates the WebSocket `Origin`
> header. The agent can be given bash, edit and write tools — never expose this server on a
> network without a sandbox **and** an auth token: set `server.token` (or the
> `PI_OUTPOST_TOKEN` environment variable, which wins) to a long random secret, e.g.
> `openssl rand -hex 32`. Binding off loopback without one is **refused**, not merely
> discouraged. Clients authenticate by opening `http://host:3141/?token=<secret>` once
> (stored locally, stripped from the URL) or via the embed widget's `token` option. Use a
> reverse proxy or Tailscale for transport encryption.
>
> The `sandbox` confines pi-outpost's file tools, not `bash`, extensions or MCP servers — see
> [what is and is not confined](sandboxing.md), and the [setup to use on each platform](sandboxing.md#recommended-setup).
