# Spec Delta

## ADDED Requirements

### Requirement: ACommitIsSignedThroughTheRelay

Under MXC on Windows, when the user's `~/.gitconfig` sets `commit.gpgsign` or `tag.gpgsign` to true,
the confined shell SHALL keep those keys on and point `gpg.program` at a shim in the sandbox cache
(via `GIT_CONFIG_*` entries), so a confined `git commit -S` produces a signature that verifies
against the user's public key, while the private key stays unreadable from the sandbox. The startup
line SHALL say that commits are signed through pi-outpost's relay.

#### Scenario: ACommitIsSignedThroughTheRelay
- **GIVEN** the user's `~/.gitconfig` with `commit.gpgsign=true`, a gpg key in `~/.gnupg`, and the agent's PowerShell confined by MXC on Windows 11 tier 1
- **WHEN** a command runs `git commit -S -m x` in the project
- **THEN** the commit carries a signature that `git log --show-signature` verifies as good, `~/.gnupg` is refused to the command, and the startup line names the signing relay

### Requirement: TheSigningRelayHoldsTheKey

The signing relay SHALL listen on the host's loopback only, answer `POST /sign/<token>` with a token
drawn at each launch and compared in constant time, accept only a whitelisted set of gpg arguments
and a body of at most 1 MiB, and run gpg (or the user's `gpg.format=ssh` signer) unconfined with the
user's real `GNUPGHOME`, `--batch` set. Any other path, method or argument SHALL be refused.

#### Scenario: TheSigningRelayHoldsTheKey
- **GIVEN** the relay started for a confined shell
- **WHEN** the shim POSTs a payload with `sign` and `-b -a -u <keyid>`, then a request with a wrong token, a `GET`, or a disallowed argument
- **THEN** the first answers an armored signature, and each of the others is refused (404/405/400), and the key file is never opened inside the container

### Requirement: WithoutGpgOnTheHostSigningStaysOff

Under MXC on Windows, when the user's `~/.gitconfig` asks for signed commits but no gpg runs on the
host or the relay cannot start, the confined environment SHALL set `commit.gpgsign`/`tag.gpgsign`
to `false` (env entries override the file) and the startup line SHALL say commits are not signed in
the sandbox and to re-sign outside it, so no commit fails on a missing gpg.

#### Scenario: WithoutGpgOnTheHostSigningStaysOff
- **GIVEN** `commit.gpgsign=true` in the user's `~/.gitconfig` and no `gpg` on the host's search path
- **WHEN** the confined shell starts and a command runs `git commit -m x`
- **THEN** the environment carries `GIT_CONFIG_VALUE_…=false` for `commit.gpgsign`, the commit succeeds unsigned, and the startup line says so
