# Proposal: sign commits through a relay, the key staying in the server

## Why

Stressing the Windows sandbox with a real agent (`pi-outpost -p` under MXC, a project with a git
repository) showed that `git commit` fails on any machine whose global `commit.gpgsign=true`:

- GnuPG for Windows is built without ASLR, which MXC's process container enforces, so `gpg.exe`
  cannot start inside it at all (`Function not implemented`), and
- even if it could, the private keys (`~/.gnupg`, `~/.ssh`) must stay out of the sandbox — a key a
  confined command can read is a key it can print and send anywhere.

So today the agent must pass `-c commit.gpgsign=false` and the user re-signs outside
(`git commit --amend --no-edit -S`). `docs/sandboxing.md` documents the failure. The registry relay
(`registryRelay.ts`, from `windows-sandbox-reach`) already solved the same shape for HTTP: the
credentials stay in the server, the sandbox only ships requests and gets answers. The loopback is
open under MXC on Windows, so the same shape applies to signing.

## What Changes

- **A signing relay in the server**, same architecture as the registry relay: a loopback HTTP
  endpoint `POST /sign/<token>`, the token drawn at each launch and compared in constant time. The
  body is the payload to sign, the query carries git's `gpg.program` arguments (whitelisted), and
  the answer is the armored signature. The server runs `gpg` (or the user's `gpg.format=ssh`
  signer) **unconfined**, with the user's real `GNUPGHOME`. Only payloads cross into the server and
  only signatures come back; the private key never enters the sandbox.
- **A shim in the sandbox cache**, made readable by the policy: the confined shell's environment
  sets `gpg.program` to it (via `GIT_CONFIG_*`, which wins over the file) **only when the user's
  `~/.gitconfig` asks for signed commits** (`commit.gpgsign`/`tag.gpgsign` true). Git calls the shim
  with the payload on stdin; the shim POSTs it to the relay and writes the signature to stdout.
- **Verification** (`git log --show-signature`) works the same way through the relay, so no key
  material — public or private — needs to be carried.
- **Fallback**: where the host has no gpg, or the relay cannot start, the environment turns
  `commit.gpgsign`/`tag.gpgsign` off (env entries win over the file) and the startup line says
  commits are not signed in the sandbox and to re-sign outside. This keeps every commit from
  failing on a missing gpg.

## Capabilities

### Modified Capabilities

- `sandbox-runner-bash`: on Windows under MXC, a confined command can produce signed commits
  through the relay; the key stays in the server.

## Impact

`server/src/` (new `signingRelay.ts`, the shim template, `terminalSandbox.ts` for the env and the
policy, `sandbox.ts` for the startup line), tests (`server/test/signingRelay.test.ts` plus the
existing suites), `docs/sandboxing.md` (the bullet that says signed commits fail), and the
`sandbox-runner-bash` spec.
