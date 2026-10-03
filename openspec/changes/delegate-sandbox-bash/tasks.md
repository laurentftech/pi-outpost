# Tasks

## 1. Configuration

- [x] 1.1 Add `sandbox.bashFrom` to `SandboxConfig`, trimmed, with blank values refused; verify *TheDelegateIsNamedInTheSandbox*

## 2. Session

- [x] 2.1 Supply no pi-outpost `bash` and exclude no `bash` when delegated (`delegatedBuiltIns`); verify *ADelegatedBashIsTheExtensions*, *WithoutDelegationTheExtensionIsShadowed* and *NoBashMeansNoDelegate*
- [x] 2.2 Refuse a session whose `bash` is not the named extension's, naming what was found (`assertDelegatedBash`); verify *AMissingDelegateRefusesTheSession* and *AnotherExtensionsBashIsRefused*

## 3. Settings

- [x] 3.1 Carry `bashFrom` across a Settings apply, and roll back a change refused for want of the extension; verify *SettingsKeepTheDelegation* and *TurningBashOnWithoutTheDelegateIsRefused*, the latter on disk too

## 4. Integration

- [x] 4.1 Check against the real pi-landstrip 0.19.4 installed by `pi install`, in an isolated agent directory: `bashFrom: "npm:pi-landstrip"` starts the session with landstrip's `bash`, and a wrong name refuses it, naming `npm:pi-landstrip`
- [x] 4.2 Document the key and how to confine bash with an extension in `README.md`
- [x] 4.3 Write `scenario-coverage.md`; run `npm run check:scenarios`, lint, typecheck and the server suite, then `openspec validate delegate-sandbox-bash --strict`
