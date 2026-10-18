# Scenario coverage

| Scenario | Status | Evidence |
|---|---|---|
| EachProviderSaysHowItIsConfigured | covered | `server/test/providerAccountsWire.test.mjs` — “a key from the server's environment shows that source, and the value never travels” and “sign in with an account, step by step, then sign out — and no token ever reaches the client”; `ui/src/components/SettingsMenu.test.tsx` — account sources/actions. |
| ADeviceCodeSignIn | covered | `server/test/providerAccountsWire.test.mjs` — “sign in with an account, step by step, then sign out — and no token ever reaches the client”; `ui/src/components/LoginFlow.test.tsx` — authorization URL and device code. |
| ACodeIsPastedBackFromAnotherMachine | covered | `server/test/providerAccountsWire.test.mjs` — “sign in with an account, step by step, then sign out — and no token ever reaches the client” (manual code prompt and response). |
| ASignInIsCancelled | covered | `server/test/providerAccountsWire.test.mjs` — “a sign-in waiting for the user is cancelled by the user, and by closing the page”; `ui/src/components/LoginFlow.test.tsx` — Cancel action. |
| OnboardingAccountSignInCanBeToggledOrSwitched | covered | `e2e/provider-accounts.spec.ts` — “onboarding account buttons toggle the current flow and switch to another provider”; `ui/src/components/Onboarding.test.tsx` — same-provider close and provider-switch callbacks; `server/test/loginRelay.test.ts` — replacement waits for the previous flow to release the socket. |
| SigningOutRemovesTheStoredCredential | covered | `server/test/providerAccountsWire.test.mjs` — “sign in with an account, step by step, then sign out — and no token ever reaches the client”. |
| AnEnvironmentKeyIsNotRemovable | covered | `server/test/providerAccountsWire.test.mjs` — “a key from the server's environment shows that source, and the value never travels”. |
| ALockedServerRefusesAccountChanges | covered | `server/test/providerAccountsWire.test.mjs` — “under credentialsLock, sign-in, keys and sign-out are refused, saying why”; `ui/src/components/SettingsMenu.test.tsx` — “offers no credential changes when credentials are locked”. |
| TerminalSignInAndOut | covered | `server/test/cliAccounts.test.ts` — “runs the account sign-in prompts and signs out only the stored credential” and “reports wrong codes and unsupported login methods”; verifies account flow selection, prompt and notification relay, wrong-code rejection, logout, and preservation of environment credentials. |

The running-app OpenAI Codex sign-in/sign-out and its monkey pass remain pending the developer's interactive account step; they have not been counted as covered.
