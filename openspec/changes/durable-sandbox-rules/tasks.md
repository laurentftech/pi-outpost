# Tasks

## 1. Verify on Windows 11 before building

- [ ] 1.1 `processContainer.captureDenials` (`mode: "block"`) with a `1.0.0` request through `wxc-exec.exe` 1.1.0: the report's real shape, where it is written, what announces its path.
- [ ] 1.2 Its cost per command, and what it needs beyond native PSEC.
- [ ] 1.3 Correct `design.md` and the spec delta by what 1.1 and 1.2 show.

## 2. Record and tell

- [ ] 2.1 One record type; translate landstrip's lines and the proxy's refused hosts into it.
- [ ] 2.2 Ask MXC for the report on Windows, read it, translate it.
- [ ] 2.3 The same on macOS, behind the development contract.
- [ ] 2.4 End a confined command's output with what the sandbox refused it.

## 3. Rules

- [ ] 3.1 The rules store, per project, in the server's state; add it to the never-grantable targets.
- [ ] 3.2 Consult rules before the host question and the directory request; apply always-allow directories when a command starts.
- [ ] 3.3 Protocol and interface: recorded refusals, rules listed and revoked, "always allow" and "always refuse" in the existing dialogs.
- [ ] 3.4 `sandbox.grants: "never"`: no rule created, none applied.

## 4. Verify

- [ ] 4.1 Each runner in its own job or machine: landstrip, MXC Linux, MXC macOS, Seatbelt, MXC Windows.
- [ ] 4.2 The running app, with a break-it pass: a rule revoked mid-command, a rule on a directory deleted since, two clients answering at once.
- [ ] 4.3 `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate durable-sandbox-rules --strict`, docs.
