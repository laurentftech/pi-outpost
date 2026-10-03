# Tasks

## 1. Configuration

- [x] 1.1 Add `sandbox.bashFrom` to `SandboxConfig`, trimmed, with blank values refused; verify *TheDelegateIsNamedInTheSandbox*

## 2. Session

- [x] 2.1 Supply no pi-outpost `bash` and exclude no `bash` when delegated (`delegatedBuiltIns`); verify *ADelegatedBashIsTheExtensions*, *WithoutDelegationTheExtensionIsShadowed* and *NoBashMeansNoDelegate*
- [x] 2.2 Refuse a session whose `bash` is not the named extension's, naming what was found (`assertDelegatedBash`); verify *AMissingDelegateRefusesTheSession* and *AnotherExtensionsBashIsRefused*

## 3. Settings

- [x] 3.1 Carry `bashFrom` across a Settings apply, and roll back a change refused for want of the extension; verify *SettingsKeepTheDelegation* and *TurningBashOnWithoutTheDelegateIsRefused*, the latter on disk too

## 4. The agent may not write `.pi`

- [x] 4.1 Refuse `write`, `edit` and every `assertWritableDestination` caller inside a `.pi` directory under the writable zone (`piConfigWriteRefusal`); verify *WriteAndEditRefuseAPiDirectory*, *ASymlinkIntoPiIsRefused*, *OtherPathsStayWritable*, *PiConfigurationStaysReadable* and *EveryFileWritingToolIsHeld*
- [x] 4.2 Document it, with multi-project behaviour and pi-landstrip's settings, in `docs/sandboxing.md`

## 5. Integration

- [x] 5.1 Check against the real pi-landstrip 0.19.4 installed by `pi install`, in an isolated agent directory: `bashFrom: "npm:pi-landstrip"` starts the session with landstrip's `bash`, and a wrong name refuses it, naming `npm:pi-landstrip`
- [x] 5.2 Document the key and how to confine bash with an extension in `README.md`
- [x] 5.3 Write `scenario-coverage.md`; run `npm run check:scenarios`, lint, typecheck and the server suite, then `openspec validate delegate-sandbox-bash --strict`
