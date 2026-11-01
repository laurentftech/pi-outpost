# Command-line reference

[Home](../README.md) · [How-to](how-to.md)

- [Command line](#command-line)

## Command line

```
pi-outpost [options]          start the server
pi-outpost -p "<prompt>" [options]
                              run one turn without a browser, the answer on stdout
pi-outpost init [options]     write a starter configuration file
pi-outpost config [options]   print the configuration that would be used, and where it came from
pi-outpost config --confine   confine the agent's shell: check this machine's runner, then set
                              "sandbox.bashRunner": "auto" (see sandboxing.md#the-default)
pi-outpost doctor [options]   check whether this installation can start and serve, and say what stops it
pi-outpost login --provider <name>
                              run account sign-in, or store an API key
pi-outpost logout --provider <name>
                              remove this server's stored credential
pi-outpost build-exe [options]
                              build a standalone executable from this installation
pi-outpost update [--check]   move to the newest published version, or just look
pi-outpost update --extensions [--check]
                              the same for the agent's pi packages (--all: both)
```

| Flag | Effect |
|------|--------|
| `--config <path>` | Configuration file to use |
| `--profile <name>` | Use `<user config dir>/profiles/<name>.json` |
| `--cwd <dir>` | Directory the agent works in |
| `--agent-dir <dir>` | pi config/session store (default `~/.pi/agent`) |
| `--port <n>` / `--host <addr>` | Where to listen (default `127.0.0.1:3141`) |
| `--offline` | Never fetch remote model catalogs |
| `--open` / `--no-open` | Open the interface once listening (default: wherever a desktop session exists) |
| `--open-in <shape>` | `window` (its own window, the default) or `browser` (a tab) |
| `--terminal` / `--no-terminal` | Enable or disable the integrated web terminal (default `false`) |
| `-h, --help` / `-v, --version` | |
| `login --provider <name>` | Run account sign-in when supported; otherwise store a key (prompted, or read from stdin — never a flag) |
| `logout --provider <name>` | Remove the credential stored by this server for that provider |
| `init --global` | Write to the user config directory instead of `./` |
| `init --force` | Overwrite an existing file |
| `build-exe --out <path>` | Where to write the executable (default `./pi-outpost`, `.exe` on Windows) |
| `build-exe --force` | Replace an existing file at that path |
| `update --check` | Report what is available and install nothing |
| `update --extensions` | Update the agent's npm pi packages instead of pi-outpost |
| `update --all` | Update pi-outpost, then those packages |
| `-p, --print <prompt>` | Run one turn and exit: see [`pi-outpost -p`](#pi-outpost--p). `-` reads the prompt from stdin |
| `--json` | With `-p`: every event of the turn, one JSON line each, instead of the text |
| `--grants <answer>` | With `-p`: `refuse` (default), `once` or `session` — the answer to a grant request |
| `--model <provider/id>` | With `-p`: the model for the turn |

There is deliberately **no `--token` flag**: a secret on the command line is readable by
anyone who can list processes. Use `PI_OUTPOST_TOKEN` or the file's `server.token`.

### `pi-outpost -p`

Runs one turn of the agent without a browser, then exits — to script a task, or to try a sandbox,
a grant or a skill from a terminal:

```bash
pi-outpost -p "What is the title of https://example.com?" --grants once
echo "Summarise README.md" | pi-outpost -p - --model openai-codex/gpt-6.1-sol
```

It is the server the configuration describes — its sandbox, runner, grants, extensions and sessions —
bound to `127.0.0.1` on a port of its own, with no browser and no terminal, and talked to as the
interface does; the turn runs in a new session. Only the assistant's answer goes to stdout; the
server's log, the tools the agent calls and every answer given go to stderr. The exit status is 0 when
the turn ended, 1 when it failed (a provider error, a model not allowed). With nobody there to click,
a grant request is answered by `--grants` (refused by default), and an extension's dialog is declined,
each said on stderr. `--json` prints the turn's events instead of its text.

### `pi-outpost doctor`

When the page will not load and it is not obvious why, run `doctor` in the directory
you start the server from. It reports, in one pass and without stopping at the first
problem:

- **installation** — the version, and whether this is a global install, a checkout, an
  `npx` run or a standalone executable
- **configuration** — which file a start would read, or, when there is none, both paths
  it looked in and the `init` that writes one
- **settings** — the address to open, the agent's working directory, the runtime,
  whether a token is set (never its value) and whether the terminal is on
- **address** — whether the port is free, already serving another Pi Outpost, or taken
  by something else
- **web UI** — whether this installation actually has an interface to serve
- **git**, and **node-pty** when the terminal is enabled
- **shell sandbox** and **terminal sandbox**, when a runner confines them — a canary run through
  the runner tries to read the agent directory, write beside the root, signal another process and
  more; any attempt that gets through is a failure (see
  [docs/sandboxing.md](sandboxing.md#check-that-it-is-really-confined)). The interface shows the
  same verdict as a lock beside the context indicator and on the terminal's badge

It exits non-zero when something would stop the server from serving, so it can gate a
script. Unlike `config`, it never needs a configuration file to run — that absence is
one of the things it is there to report.

**The most common cause of "the page does not connect", in a directory you have not
used before**: there is no configuration file, so the server prints the paths it
searched and exits before it ever binds the port. Installing Pi Outpost globally does
not create one — the install and the configuration are separate acts:

```
pi-outpost init            # a configuration for this directory
pi-outpost init --global   # one that every directory falls back to
```

The global file lives in `<user config dir>/config.json` — `$XDG_CONFIG_HOME/pi-outpost`
or `~/.config/pi-outpost`, which on Windows means `C:\Users\<you>\.config\pi-outpost`
and **not** `%APPDATA%`. `doctor` prints the resolved path, so there is nothing to guess.
