# Design: sign through the server, like the registries

## Measured

- On Windows 11 under MXC (tier 1), with `commit.gpgsign=true` in the user's `~/.gitconfig`, a
  confined `git commit` fails: `gpg.exe` answers `Function not implemented` — GnuPG for Windows is
  built without ASLR, which the container enforces (microsoft/mxc process container). Reproduced
  by a real agent turn (`pi-outpost -p`, sandbox root a git project): the agent had to commit with
  `-c commit.gpgsign=false` and re-sign outside.
- The loopback is open under MXC on Windows (`hostLoopback`, default on): a confined command
  reaches services listening on `127.0.0.1` of the host. The registry relay already uses this.
- `git` calls `gpg.program` with the payload on stdin and args like `-bsau <keyid>` for signing,
  `--status-fd=… --verify <sig> <payload>` for verification. `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/
  `GIT_CONFIG_VALUE_n` environment entries override the file configuration, so the confined
  environment can point `gpg.program` at the shim without touching the user's file.

## Mechanism

1. **Relay** (`server/src/signingRelay.ts`), started with the sandbox's bash: an HTTP server on
   `127.0.0.1`, one random token per launch, path `/sign/<token>`. `POST` only, body capped
   (a commit payload is kilobytes; 1 MiB is generous). The query names the operation (`sign` or
   `verify`) and the whitelisted gpg args (`-b`, `--detach-sign`, `-a`, `--armor`, `-u`,
   `--local-user`, `--status-fd`, `--verify`, `--output -`); anything else is refused. The server
   runs `gpg --batch …` (or `ssh-keygen -Y sign` for `gpg.format=ssh`, from the user's gitconfig)
   **unconfined**, with the user's real `HOME`/`GNUPGHOME`, payload on stdin, and returns stdout.
   The token is compared with `timingSafeEqual`, as the registry relay does.
2. **Shim**: a small script written into the sandbox cache (readable by the policy, like the
   carried configurations) — `gpg-relay.ps1` on Windows — which reads stdin, POSTs it with the
   args to `http://127.0.0.1:<port>/sign/<token>?…`, and writes the answer to stdout. Git never
   sees the key; nothing but payloads and signatures cross.
3. **Environment** (`confinedEnvironment` in `terminalSandbox.ts`), on Windows only, and only when
   the user's `~/.gitconfig` sets `commit.gpgsign`/`tag.gpgsign` true (parsed by
   `gitSigningKeysEnabled`): set `gpg.program` to the shim via `GIT_CONFIG_*`, leave `gpgsign` on.
   If the relay did not start (no gpg on the host, port refused), instead set those keys to `false`
   and let the startup line say so.
4. **Startup line** (`networkSummary` in `sandbox.ts`): under MXC on Windows, when signing is
   requested, the line says whether commits are signed through pi-outpost's relay or unsigned
   (fallback), and that re-signing outside remains possible.

## Security

- The private key never enters the sandbox: the policy never allows `~/.gnupg` or `~/.ssh`; the
  shim ships only payloads out and signatures back.
- The endpoint is loopback-only and token-pathed, like the registry relay; any local process with
  the token could get a payload signed — the same trust the agent already has (it can ask the user
  for a grant to run git unconfined), and far less than reading the key.
- Args are whitelisted; gpg runs with `--batch` so it never prompts into a sandbox-visible tty.
- Body size is capped; the server answers 404 for any other path, as the relay does.

## Known limits, kept

- Signing is a Windows-MXC feature: on POSIX runners gpg may run confined and is left alone.
- A `gpg.program` the user set themselves is overridden by the shim in the sandbox; the server
  resolves the user's own `gpg.program` when it runs gpg, so their signer still applies server-side.
- Smartcard/YubiKey signing needs device access the container does not have; the relay signs with
  the software key in `~/.gnupg`. Documented in `docs/sandboxing.md`.
