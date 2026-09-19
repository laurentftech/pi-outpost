# Scenario coverage — notify-updates-in-the-interface

Server scenarios for pi packages run over a real server, a real npm and a registry of the test's own
(`server/test/piPackagesWire.test.mjs`): a tiny pi extension published at 1.0.0 and 1.1.0, each registering a tool
named after its version, installed by npm into a fixture agent directory — so "installed" is read from disk and
"loaded" from the tools the agent was given. Listing and checking are unit-tested over fixture agent directories
sealed from this machine's own installs (`server/test/piPackages.test.ts`); the pi-outpost notice through
`runStartupUpdateNotice` (`server/test/update.test.ts`). Interface scenarios render the components in jsdom.

The whole path was also rehearsed on a packed build installed into an isolated global prefix, against a fake
registry announcing pi-outpost 99.0.0: the notice, the package offered, confirmed, installed, the restart from
the interface, the reconnect, the new version's tool running, a dead registry, and Ctrl-C through the restarted
server. That rehearsal found a startup crash no suite could reach (see the design's restart decision).

## Capability: `update` (4 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| ANewerVersionIsAnnouncedInTheInterface | covered | `server/test/update.test.ts` — "tells the interface about a newer version, with what this installation should do": a global install at 0.26.0 with 0.27.0 published hands on `{ running, latest, instruction: 'Run "pi-outpost update" …', copy: "pi-outpost update" }`, an executable the download instruction; `ui/src/components/UpdateNotice.test.tsx` — "names both versions, says what to run, and offers to copy it"; `ui/src/App.test.tsx` — "is shown in the standalone app" |
| ADismissedNoticeStaysDismissedForThatVersion | covered | `ui/src/components/UpdateNotice.test.tsx` — "stays dismissed for that version, and comes back for the next one": dismissed for 0.27.0, absent on a fresh render for 0.27.0, present for 0.28.0 |
| NoNoticeWithoutANewerVersion | covered | `server/test/update.test.ts` — "tells the interface nothing when current, when the check fails, when off, or for a one-off run": no notice for a current version, a failed lookup, `updateCheck: false`, or an ephemeral run |
| AWidgetShowsNoNotice | covered | `ui/src/App.test.tsx` — "is not shown in a widget": an embedded app holding a notice renders none |

## Capability: `pi-package-updates` (13 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AnInstalledPackageIsListed | covered | `server/test/piPackages.test.ts` — "an installed package is listed with its name and installed version"; `ui/src/components/PiPackages.test.tsx` — "say their version, a newer one, a failed check with its reason, pinned, and not installed" |
| APinnedPackageIsSaidToBePinned | covered | `server/test/piPackages.test.ts` — "a pinned package says so, one not installed has no version, and git sources are left out" (`pinned: "3.1.1"`), and "a pinned package or one not installed is not looked up"; `ui/src/components/PiPackages.test.tsx` — the pinned row reads "1.0.0, pinned" and offers no Update |
| ANewerVersionIsShown | covered | `server/test/piPackages.test.ts` — "a newer published version is shown"; `server/test/piPackagesWire.test.mjs` — "a newer version is offered and installed, then a restart loads it": after publishing 1.1.0 and `check_pi_packages`, the list says `{ state: "newer", latest: "1.1.0" }` with 1.0.0 installed |
| AFailedCheckIsNotUpToDate | covered | `server/test/piPackages.test.ts` — "a failed lookup is not up to date, says why, and is asked again next time"; `ui/src/components/PiPackages.test.tsx` — the failed row reads "not checked: the registry answered 503" and not "up to date" |
| CheckingOffLooksUpNothing | covered | `server/test/piPackages.test.ts` — "with checking off nothing is looked up, and the list says so": the lookup is never called and the state is `off` with the reason |
| AConfirmedUpdateIsInstalledAndAsksForARestart | covered | `server/test/piPackagesWire.test.mjs` — "a newer version is offered and installed, then a restart loads it": the answer is `installed`, "1.1.0 is installed — restart pi-outpost to use it", matching neither "loaded" nor "running", and the list then carries 1.1.0 with `restartNeeded`; "a version changed behind the server's back needs a restart too"; `ui/src/components/PiPackages.test.tsx` — "shows the answer, and an installed update as needing a restart" |
| NothingIsSentWithoutConfirmation | covered | `ui/src/components/PiPackages.test.tsx` — "is confirmed in place, naming both versions, and cancelling sends nothing": the confirmation names "33.0.1 → 33.1.0" and the agent's privileges, Cancel calls nothing, Install calls `onUpdate` with the source |
| AnUpdateWaitsForARunningTurn | covered | `server/test/piPackagesWire.test.mjs` — "an update waits for a turn that is running, and changes nothing": refused naming the busy project, and the installed `package.json` is still 1.0.0 |
| AFailedInstallChangesNothing | covered | `server/test/piPackagesWire.test.mjs` — "an install that fails leaves the installed version and says why": with the registry withholding tarballs (and a cache of the test's own), the answer is `failed` and the list still says 1.0.0 |
| LockedExtensionsOfferNoUpdate | covered | `server/test/piPackagesWire.test.mjs` — "locked extensions refuse an update": `refused`, "locked"; `ui/src/components/PiPackages.test.tsx` — "is not offered when extensions are locked" |
| ARestartLoadsTheUpdatedPackage | covered | `server/test/piPackagesWire.test.mjs` — "a newer version is offered and installed, then a restart loads it": after `restart_server` the client receives `server_restarting`, the server comes back on the same port, and a new connection's tools include `fake_ext_v1_1_0` and not `fake_ext_v1_0_0`; `ui/src/useAgent.test.ts` — "sends a package update, keeps its answer, and marks a restart until the next snapshot" |
| ARestartWaitsForRunningTurns | covered | `server/test/piPackagesWire.test.mjs` — "a restart waits for a running turn": refused with "is working — stop its turn before restarting", and no `server_restarting` is sent |
| AWidgetCannotRestartTheServer | covered | `server/test/piPackagesWire.test.mjs` — "a widget's connection cannot restart the server": a connection whose `Origin` is a configured host page is refused, and nothing restarts; `ui/src/components/PiPackages.test.tsx` — "is not offered in a widget, nor when nothing needs it" |
