## 1. Server

- [ ] 1.1 `accountRuntime` adapter over the embedded runtime's `modelRuntime`: providers with state, source, methods, removability; login; logout. Refused under the RPC runtime.
- [ ] 1.2 Login relay: `start_login`, `login_event`, `login_prompt`, `login_prompt_cancelled`, `login_answer`, `cancel_login`, `login_done`; one flow per socket; aborted on close.
- [ ] 1.3 `logout_provider`; refresh models and credentials after sign-in and sign-out; broadcast.
- [ ] 1.4 `credentialsLock`: config, snapshot, refusals of every credential-changing message.

## 2. Protocol

- [ ] 2.1 Provider states in `CredentialStatus` (no secret); the login messages.

## 3. Interface

- [ ] 3.1 Settings → Accounts: rows with state and source, Sign in / API key / Sign out; read-only under the lock.
- [ ] 3.2 The sign-in dialog: link and copy for a URL, device code and address, prompts (text, secret, select, manual code), progress, Cancel; errors.
- [ ] 3.3 Onboarding: "Sign in with an account".

## 4. CLI

- [ ] 4.1 `pi-outpost login --provider <id>` runs the account flow when there is one and no key is piped; `pi-outpost logout --provider <id>`.

## 5. Tests

- [ ] 5.1 Server: a fake provider flow (device code, prompts, manual code, cancel, close), states and sources, removability, the lock, no secret in messages.
- [ ] 5.2 UI: the accounts rows, the dialog's steps, the lock, onboarding.
- [ ] 5.3 CLI: account flow and logout with a fake runtime.
- [ ] 5.4 Running app: a real account sign-in and sign-out with a provider the developer has; monkey pass (cancel mid-flow, close the tab, two tabs, a wrong code).

## 6. Documentation and checks

- [ ] 6.1 README *Model credentials* and the CLI table; the configuration reference (`credentialsLock`).
- [ ] 6.2 `scenario-coverage.md`, `openspec validate --strict`, `check:scenarios`, typecheck, lint, suites.

## After merge

- Archive the change from `main`.
