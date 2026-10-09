# Tasks

## 1. Configuration and refusals

- [ ] 1.1 Parse `accounts` (`root`, optional registry path, `sessionIdleHours` default 12) in `server/src/config.ts`; verified by config tests covering a relative `root` resolved against the config file (`path.join` expectations, Windows-safe), plus NoAccountsBlockKeepsTodaysBehaviour and AccountsBlockTurnsTheModeOn as server tests (no sign-in without `accounts`; no content before sign-in with it).
- [ ] 1.2 Refuse at load, naming the setting: shared token + `accounts`, `sandbox.allowBash` without `bashFrom`, a provider key variable in the server's environment; verified by one test per refusal plus the accepted delegated-bash case (UndelegatedBashIsRefused, DelegatedBashIsAccepted, SharedTokenIsRefused, AKeyInTheEnvironmentIsRefused).
- [ ] 1.3 Run the same refusals on the settings-apply path; verified by a server test that submits each through `update_config` as an administrator and sees it refused with the configuration unchanged.

## 2. Account registry and passwords

- [ ] 2.1 Password module: scrypt `scrypt$N$r$p$salt$hash`, `timingSafeEqual`, dummy hash for unknown ids, minimum 8 characters; verified by unit tests (round trip, wrong password, stored parameters honoured) and AShortPasswordIsRefused.
- [ ] 2.2 Account store: load/validate `accounts.json`, id rule (lowercase, digits, `-`, `_`, unique), atomic write with mode 0600, per-account `openProjects`, create root on account creation, reload on file change; verified by unit tests including AnUnusableIdIsRefused, CreatingAnAccountCreatesItsRoot, NoPasswordInClear, and a reload after an external write.
- [ ] 2.3 Invariant "at least one enabled administrator" enforced by every mutating operation; verified by TheLastAdministratorStays as a unit test on the store.
- [ ] 2.4 Startup refuses multi-user mode with no enabled administrator, naming `pi-outpost user add <id> --admin`; verified by NoAdministratorNoStart as a server start test.

## 3. Command line

- [ ] 3.1 `pi-outpost user add <id> [--admin] [--name]`, `user reset <id>`, `user list`, reading the password without echo (and from stdin when not a TTY, for scripted Docker setups); warn when the server is running; verified by CLI tests against a temporary registry (BootstrappingTheFirstAdministrator end to end: add, start, sign in).
- [ ] 3.2 Document the commands in `pi-outpost --help` and the CLI spec's flag list; verified by the existing help-output test updated.

## 4. Sign-in, sessions and throttling

- [ ] 4.1 Replace `tokenValid` with `authenticate(): Principal | undefined` at every call site (WS, `/branding`, `/files/raw`, `/files/docx-template`); single-user behaviour unchanged; verified by the existing auth suite passing untouched plus a test per surface rejecting a bad session token in multi-user mode.
- [ ] 4.2 `POST /auth/login` and `/auth/logout`, in-memory hashed session tokens with idle expiry, identical refusal for unknown/wrong/disabled; verified by SignedInClientReachesItsProjects, FailuresLookAlike, ExpiredSessionAsksToSignInAgain (clock injected), SignOutEndsTheSession.
- [ ] 4.3 Throttling by account id and by address with growing delay, reset on success; verified by GuessingIsSlowedDown (right password refused while throttled).
- [ ] 4.4 Must-change-password gate: only the password-change message accepted; change requires current password, refuses the same one, ends other sessions; verified by FirstSignInAsksForANewPassword and ChangingThePasswordEndsOtherSessions.
- [ ] 4.5 `/health` and `/branding` advertise `signIn: "local"` in multi-user mode without exposing accounts; verified by a route test in both modes.

## 5. Ownership and isolation

- [ ] 5.1 `Workspace.owner`, socket principals, and `workspaceFor(principal, idOrRoot)` as the only client-facing lookup (WS `?workspace=`, `switch_workspace`, `open_side_session`, `/files/raw` binding); verified by NamingAnotherAccountsProjectIsRefused, asserting the refusal is byte-identical to a non-existent project's.
- [ ] 5.2 Per-account default project at the account root and per-account `openProjects`; `open_project` confined to the account root; verified by EachAccountHasItsOwnOpenProjects, OpeningOutsideTheAccountRootIsRefused, AFirstSignInIsServedTheAccountRoot.
- [ ] 5.3 Directory browsing confined to the account root (symlink-safe, no walking above it); verified by A signed-in account browses only its root and A path outside the account root is refused, including a symlink inside the root pointing out.
- [ ] 5.4 Split `broadcastServerWide`: activity and attention to the owner's sockets, server notices to administrators; verified by ActivityStaysWithinTheAccount and a test that a `user` socket receives no update/restart notice.
- [ ] 5.5 Retire an account's default project once none of its clients is bound; verified by ALeftAccountReleasesItsAgents with an injected clock.
- [ ] 5.6 Isolation sweep: TwoUsersDoNotSeeEachOther and AnAdministratorDoesNotReadOthersWork as one server test listing projects, sessions, files and searching sessions as each account.

## 6. Permissions and account administration

- [ ] 6.1 `ADMIN_ONLY` table checked before dispatch; `open_native`/`reveal_native` refused in multi-user mode; verified by AUserCannotChangeTheConfiguration, OpeningOnTheServerDesktopIsRefused, AnAdministratorSetsTheSharedKey and AUserChoosesItsModel.
- [ ] 6.2 Enumeration test: every `ClientMessage` type is either in `ADMIN_ONLY` or in an explicit user-permitted list, so an unclassified new type fails CI.
- [ ] 6.3 Protocol messages for account administration (list, create, reset, set role, disable, enable, delete) and password change, in `shared/src/protocol.ts`; snapshot carries the account id, display name, role and must-change flag.
- [ ] 6.4 Disable/delete: close the account's sockets, stop running turns, end sessions, retire its projects; delete keeps the root; verified by DisablingCutsTheUserOff and DeletingKeepsTheFiles.

## 7. Confined terminal (depends on `confined-terminal`)

- [ ] 7.1 In multi-user mode, pass the account root to `terminalPolicy()` with `<accounts.root>` denied, and never spawn an unconfined terminal; unit test on the generated policy, plus NoRunnerNoTerminalForAnyone as a server test (administrator included).
- [ ] 7.2 Linux container test with the real runner: AlicesTerminalStaysInHerRoot, Linux CI job only.
- [ ] 7.3 Verify and document the agent's `pi-landstrip` policy for multi-user (`readAccess: "policy"`, accounts root denied): a container test where one account's agent `bash` cannot read another account's root.

## 8. Interface

- [ ] 8.1 Sign-in screen (id + password) when the server advertises `signIn: "local"`, storing the session token like today's token; password-change screen when required; sign-out in the header; verified by UI tests and in the running app.
- [ ] 8.2 Hide administration controls from `user` accounts (credentials, packages, sandbox, agent resources, restart, native open) while keeping model and thinking selection; verified by AUserDoesNotSeeAdministrationControls as a UI test.
- [ ] 8.3 Accounts panel in Settings for administrators: list, create with initial password and role, reset, change role, disable/enable, delete with confirmation; verified by UI tests and in the running app.
- [ ] 8.4 Embed: the `token` option accepts a session token in multi-user mode; verified by an embed test connecting with a session token.

## 9. Verification and documentation

- [ ] 9.1 Bench: add a multi-user server to `npm run bench` (two accounts and an administrator, seeded projects); drive sign-in, first-login password change, two users side by side, administrator disabling a connected user, then a monkey pass (sign out mid-turn, disable during a switch, reuse an expired token, double-submit sign-in); record what broke.
- [ ] 9.2 Documentation: README and `docs/` section "Sharing one server between several people" (enable, bootstrap, what is refused and why, extensions are trusted code, backups of `accounts.json`); validate the documented commands.
- [ ] 9.3 `scenario-coverage.md` mapping every scenario of the three delta specs to its test; `npm run check:scenarios` and `openspec validate --strict` pass.
- [ ] 9.4 Full suites green on Linux, macOS and Windows CI (paths via `path.join`, CRLF-safe reads of `accounts.json`).

## Workflow follow-up

- After merge, archive this change from `main`.
- Next change: OIDC sign-in on the same account registry.
