# Scenario coverage — add-reveal-in-file-manager

Capabilities: `file` (1 added requirement, 5 scenarios; 1 modified requirement, 3 scenarios),
`api` (1 added requirement, 1 scenario).

## file

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| RevealAFileOnEachPlatform | covered | `server/test/fileBrowser.test.ts` — "RevealAFileOnEachPlatform: Finder, Explorer and the freedesktop file manager, each given the validated path". On a file named `my report, final.docx`, asserts the exact calls: `open -R <absolute path>` on darwin; `explorer.exe /select, <absolute path>` with any exit code accepted on win32; on linux, `dbus-send` with the full `org.freedesktop.FileManager1.ShowItems` invocation and the file URI, spaces and the comma percent-encoded. `server/test/revealNativeWire.test.mjs` runs the Linux (or macOS) call through the server's real spawn. |
| LinuxFallsBackToTheContainingFolder | covered | `server/test/fileBrowser.test.ts` — "LinuxFallsBackToTheContainingFolder: when no file manager answers, xdg-open opens the folder". A launcher failing `dbus-send` yields the calls `dbus-send` then `xdg-open <containing folder>`; when both fail the reason is `launcher-failed`. |
| ExplorersExitCodeIsNotAFailure | covered | `server/test/fileBrowser.test.ts` — the reveal test asserts `{ anyExitCode: true }` on the Explorer call; "the real launcher: a non-zero exit fails unless any exit code is accepted, and a missing program always fails" runs the real `launchNative` on a process exiting 1 (rejected, then accepted with `anyExitCode`) and on a program that does not exist (rejected even with `anyExitCode`). |
| RevealIsConfined | covered | `server/test/fileBrowser.test.ts` — "RevealIsConfined: an escaping, a traversal or a missing path is refused before anything is launched" asserts `outside-root` for `../outside/secret.txt` and an absolute path outside, `not-found` for a missing file, and that the launcher was never called; "a folder is revealed like a file, and nothing needs to be writable". `revealNativeWire.test.mjs` asserts the same refusals over the wire, and that the fake file manager recorded no call for them. |
| TheTreeOffersRevealOnFilesAndFolders | covered | `ui/src/components/FileTree.test.tsx` — "TheTreeOffersRevealOnFilesAndFolders: a file row and a folder row each ask to be shown in the file manager" presses the control on a file and a folder of a read-only tree and asserts `onRevealNative` got each path; "offers no reveal control when the page cannot ask for one"; "shows why a reveal failed, on the tree"; and in `useAgent.test.ts` the tail of a double-click on the same path sends nothing while another path is sent asserts the error message in the tree's alert. `ui/src/useAgent.test.ts` — "sends typed lifecycle requests with correlated ids" asserts `revealNative` sends `reveal_native` with a `fileop:` request id and marks the operation pending. |
| Open a Word document natively | covered | `server/test/fileBrowser.test.ts` — "launches a confined read-only file without a shell command" (unchanged). |
| Refuse native opening outside the browser root | covered | `server/test/fileBrowser.test.ts` — "never invokes the launcher for an escaping path" (unchanged). |
| OpeningOnWindowsIsShownAndNotMisreported | covered | `server/test/fileBrowser.test.ts` — "ExplorersExitCodeIsNotAFailure: opening on Windows accepts whatever Explorer exits with" asserts `explorer.exe <file>` with `{ anyExitCode: true }`; "launchers are never started hidden: Explorer passes a hidden show state on to what it opens" asserts the spawn options carry no `windowsHide` (which libuv turns into `SW_HIDE`); the real-launcher test above shows the exit code is then ignored. Word or Explorer themselves are not on CI: confirmed from libuv's `process.c` and Node's `process_wrap.cc`, to check on Windows by the owner. |

## api

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| RevealIsAcknowledgedOrRefusedUnderItsRequestId | covered | `server/test/revealNativeWire.test.mjs` — over a real server and WebSocket, a missing path and an escaping path are answered with `file_browser_error` (`not-found`, `outside-root`) under their request ids; an existing file with a `file_operation_result` for `reveal_native` under its id, after exactly one launcher call recorded by a fake `dbus-send` (or `open`) first on the server's PATH. On Windows only the refusals run. |
