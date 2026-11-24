# Tasks

- [ ] 1. `server/src/signingRelay.ts`: loopback endpoint `POST /sign/<token>`, token drawn per launch and compared with `timingSafeEqual`, whitelisted gpg args, 1 MiB body cap, gpg (or `gpg.format=ssh` signer) run unconfined with the user's `GNUPGHOME` and `--batch`.
- [ ] 2. The shim written into the sandbox cache (`gpg-relay.ps1` on Windows) and made readable by the policy; reads stdin, POSTs payload + args, writes the signature to stdout.
- [ ] 3. `confinedEnvironment` (`server/src/terminalSandbox.ts`): on Windows, when `gitSigningKeysEnabled` finds gpgsign on in the user's `~/.gitconfig`, set `gpg.program` to the shim via `GIT_CONFIG_*`; when the relay did not start, set those keys to `false` instead.
- [ ] 4. The startup line (`networkSummary` in `server/src/sandbox.ts`): under MXC on Windows, say whether commits are signed through the relay or unsigned (fallback).
- [ ] 5. Tests: `server/test/signingRelay.test.ts` (token, whitelist, cap, sign and verify round-trip with a test key, refusals), plus `terminalSandbox.test.ts` (env overrides) and `landstripNotes.test.ts` (startup line).
- [ ] 6. A real-MXC test where `MXC_EXEC` is set: a confined `git commit -S` verifies with `git log --show-signature`, `~/.gnupg` refused.
- [ ] 7. Docs: `docs/sandboxing.md` — replace the "signed commits fail" bullet with the relay and its fallback.
