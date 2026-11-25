# Spec Delta

## ADDED Requirements

### Requirement: ACommitIsSignedThroughTheRelay

Under MXC on Windows, when the user's `~/.gitconfig` sets `commit.gpgsign` or `tag.gpgsign` to true
and the signing relay can serve them, the confined shell SHALL keep those keys on and point
`gpg.program` at a shim in the sandbox cache (via `GIT_CONFIG_*` entries), so a confined
`git commit -S` produces a signature made by the server, while the private key stays unreadable from
the sandbox. The startup line SHALL say that commits are signed through pi-outpost's relay.

#### Scenario: ACommitIsSignedThroughTheRelay
- **GIVEN** the user's `~/.gitconfig` with `commit.gpgsign=true`, a gpg key in `~/.gnupg`, gpg on the host's search path, and the agent's PowerShell confined by MXC on Windows 11 tier 1
- **WHEN** a command runs `git commit -S -m x` in the project
- **THEN** the commit carries a signature that verifies as good against the user's public key (checked outside the sandbox or from the app), `~/.gnupg` is refused to the command, and the startup line names the signing relay

### Requirement: TheSigningRelayServesOnlyWhatItCanRun

The relay SHALL serve a git configuration only when `gpg.format` is OpenPGP, a signer (gpg, or the
`gpg.program` the file names) resolves on the host's search path, and the host's loopback is open to
the sandbox (`sandbox.hostLoopback` not false). Otherwise it does not start for that shell.

#### Scenario: TheSigningRelayServesOnlyWhatItCanRun
- **GIVEN** `commit.gpgsign=true` in the user's `~/.gitconfig`, and each in turn: `gpg.format=ssh`, no gpg on the host's search path, `hostLoopback: false` in the sandbox configuration
- **WHEN** the confined shell's environment is built
- **THEN** no `gpg.program` entry is set for any of them, and the fallback requirement applies

### Requirement: TheSigningRelayHoldsTheKey

The signing relay SHALL listen on the host's loopback only, answer `POST /sign/<token>` with a token
drawn at each launch and compared in constant time, accept only a whitelisted set of gpg signing
arguments (`--verify` among the refused) and a body of at most 1 MiB, and run gpg — or the user's
own `gpg.program` when their gitconfig names one — unconfined with the user's real `GNUPGHOME`,
`--batch` set. Sign only: any other path, method or argument SHALL be refused.

#### Scenario: TheSigningRelayHoldsTheKey
- **GIVEN** the relay started for a confined shell
- **WHEN** the shim POSTs a payload with `-b -a -u <keyid>`, then a request with a wrong token, a `GET`, a `--verify`, or another disallowed argument
- **THEN** the first answers the signature, and each of the others is refused (404/405/400), and the key file is never opened inside the container

### Requirement: WithoutARunnableRelaySigningStaysOff

Under MXC on Windows, when the user's `~/.gitconfig` asks for signed commits but the relay cannot
serve them (no signer on the host's search path, `gpg.format` not OpenPGP, or the host's loopback
closed), the confined environment SHALL set `commit.gpgsign`/`tag.gpgsign` to `false` (env entries
override the file) and the startup line SHALL say commits are not signed in the sandbox and to
re-sign outside it, so no commit fails on a missing gpg.

#### Scenario: WithoutGpgOnTheHostSigningStaysOff
- **GIVEN** `commit.gpgsign=true` in the user's `~/.gitconfig` and no signer the relay can run (no `gpg` on the host's search path, or `gpg.format=ssh`, or `hostLoopback: false`)
- **WHEN** the confined shell starts and a command runs `git commit -m x`
- **THEN** the environment carries `GIT_CONFIG_VALUE_…=false` for `commit.gpgsign`, the commit succeeds unsigned, and the startup line says so
