# Tasks

- [x] 1. `server/src/signingRelay.ts`: loopback endpoint `POST /sign/<token>`, token drawn per launch and compared with `timingSafeEqual`, whitelisted gpg signing args (`--verify` refused: sign only), 1 MiB body cap, gpg (or the user's own `gpg.program`) run unconfined with the user's `GNUPGHOME` and `--batch --yes`.
- [x] 2. The shim written into the sandbox cache (`gpg-relay.cmd` + inner `.ps1` on Windows, made readable by the policy); reads stdin, POSTs payload + args, writes the signature to stdout.
- [x] 3. `confinedEnvironment` (`server/src/terminalSandbox.ts`): on Windows, when `gitSigningKeysEnabled` finds gpgsign on in the user's `~/.gitconfig`, set `gpg.program` to the shim via `GIT_CONFIG_*`; when the relay cannot serve (`signingShimFor`: no signer on the host, `gpg.format` not OpenPGP, loopback closed), set those keys to `false` instead. Wired into the agent's shell (`agentBashOptions`) and the confined terminal (`confinedLaunch`).
- [x] 4. The startup line (`networkSummary` in `server/src/sandbox.ts`): under MXC on Windows, say whether commits are signed through the relay or unsigned (fallback).
- [x] 5. Tests: `server/test/signingRelay.test.ts` (token 404, POST-only 405, arg whitelist incl. `--verify` refused, 413 cap, sign round-trip, 500 on signer failure, shim contents), plus `terminalSandbox.test.ts` (env overrides with and without the shim) and `landstripNotes.test.ts` (startup line, relay and fallback).
- [ ] 6. A real-MXC test where `MXC_EXEC` is set (Windows, gpg on the host): a confined `git commit -S` carries a signature that verifies outside, `~/.gnupg` refused.
- [x] 7. Docs: `docs/sandboxing.md` — replace the "signed commits fail" bullet with the relay, its sign-only limit, and its fallback.
