## ADDED Requirements

### Requirement: ProvidersAreListedWithTheirState

The interface SHALL list the providers the server knows, each with its state — signed in with an
account, an API key stored by this server, a key from the server's environment or configuration, or not
configured — and the ways it can be set up, without ever carrying a secret.

#### Scenario: EachProviderSaysHowItIsConfigured
- **GIVEN** a server with an account sign-in stored for one provider, an API key stored for another, and a key in the server's environment for a third
- **WHEN** the user opens the accounts section
- **THEN** each of the three shows its state and source, the others show "not configured", and no message carries a key or a token

### Requirement: SignInWithAnAccountFromTheBrowser

For a provider that offers an account flow, the interface SHALL run it through the server and relay to
the browser that started it every step the flow asks for — an authorization URL, a device code, a
question, a code to paste — and SHALL let the user cancel it. On success the provider's models SHALL be
usable without a restart.

#### Scenario: ADeviceCodeSignIn
- **GIVEN** a provider whose flow shows a device code
- **WHEN** the user starts signing in, and the flow reports the code and the address to enter it at, then completes
- **THEN** the browser shows the code and the address, then the provider as signed in, and its models are offered

#### Scenario: ACodeIsPastedBackFromAnotherMachine
- **GIVEN** a flow that waits for a redirect to the server's loopback, and a browser on another machine
- **WHEN** the flow asks for the authorization code and the user pastes it
- **THEN** the server receives exactly what was pasted, and only the browser that started the flow was asked

#### Scenario: ASignInIsCancelled
- **GIVEN** a sign-in waiting for the user
- **WHEN** the user cancels it, or closes the page
- **THEN** the flow is aborted, nothing is stored, and the provider's state is unchanged

#### Scenario: OnboardingAccountSignInCanBeToggledOrSwitched
- **GIVEN** the onboarding screen offers account sign-in for more than one provider
- **WHEN** the user selects a provider a second time
- **THEN** that provider's sign-in panel closes and its flow is cancelled without showing a cancellation error
- **WHEN** a different provider is selected while a sign-in is open
- **THEN** the open flow is cancelled and the newly selected provider's sign-in starts

### Requirement: SignOutRemovesOnlyWhatThisServerStored

The interface SHALL remove a credential this server stored (an account sign-in or an API key in the agent
directory). A key from the server's environment or configuration SHALL be shown with its source and SHALL
NOT be offered for removal.

#### Scenario: SigningOutRemovesTheStoredCredential
- **GIVEN** a provider signed in with an account
- **WHEN** the user signs out
- **THEN** the credential is gone from the agent directory, the provider shows "not configured", and its models are no longer offered

#### Scenario: AnEnvironmentKeyIsNotRemovable
- **GIVEN** a provider whose key comes from the server's environment
- **WHEN** the user looks at it
- **THEN** it shows the environment as its source and offers no removal

### Requirement: CredentialsCanBeLocked

With `credentialsLock: true`, the interface SHALL NOT offer to sign in, re-key or remove credentials, and
the server SHALL refuse such requests; the CLI SHALL still manage them.

#### Scenario: ALockedServerRefusesAccountChanges
- **GIVEN** `credentialsLock: true`
- **WHEN** a client asks to sign in, store a key or sign out
- **THEN** the server refuses with the reason, and the interface shows the providers' states without the actions

### Requirement: AccountsFromTheTerminal

`pi-outpost login --provider <id>` SHALL run the provider's account flow when it has one and no key is
piped in — printing the URL or device code and reading pasted answers — and `pi-outpost logout --provider
<id>` SHALL remove the credential this server stored for it.

#### Scenario: TerminalSignInAndOut
- **GIVEN** a provider with an account flow
- **WHEN** the operator runs `pi-outpost login --provider <id>`, follows the printed step, then `pi-outpost logout --provider <id>`
- **THEN** the credential is stored in the agent directory after the first, and gone after the second
