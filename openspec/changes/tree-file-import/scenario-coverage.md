# Scenario coverage

OpenLore was unavailable (offline CLI cache miss). The matrix below comes from targeted source,
assertion and protocol inspection. Browser tests run the built application against the real server
and read the DOM, outgoing messages and on-disk bytes. Folder entries and oversized files use
browser-side API instrumentation to exercise their refusal without allocating a 26 MB file.

| Scenario | Status | Test and asserted boundary |
| --- | --- | --- |
| ImportIntoAFolder | covered | `e2e/tree-file-import.spec.ts`: `ImportIntoAFolder and ImportReportsCollisions` checks hover, no global attachment overlay, exact binary bytes, tree rows and no attachment; `ui/src/components/FileTree.test.tsx`: `ImportIntoAFolder` checks the request and saved-path feedback. |
| ImportIntoTheRoot | covered | `e2e/tree-file-import.spec.ts`: `ImportIntoTheRoot` reads empty and nonempty files at the root; `ui/src/useAgent.test.ts`: `sends an explicit existing destination, including the root, and resolves the saved name` checks empty-path wire encoding. |
| ReadOnlyDropIsNotAnAttachment | covered | `e2e/tree-file-import.spec.ts`: both `ReadOnlyDropIsNotAnAttachment` tests check no upload, unchanged disk and no image attachment for a restricted folder and a read-only workspace. |
| ImportReportsCollisions | covered | `e2e/tree-file-import.spec.ts`: `ImportIntoAFolder and ImportReportsCollisions` checks original bytes, suffixed file bytes and actual-path feedback. |
| ImportReportsIndividualFailures | covered | `ui/src/components/FileTree.test.tsx`: `ImportReportsIndividualFailures` checks the oversized file is never read and a valid one succeeds; `e2e/tree-file-import.spec.ts`: `ImportReportsIndividualFailures and FolderDropsAreRefused` checks mixed results and disk contents. |
| FolderDropsAreRefused | covered | `ui/src/components/FileTree.test.tsx`: `FolderDropsAreRefused` checks no callback and an explanation; `e2e/tree-file-import.spec.ts`: mixed-item test asserts no directory placeholder on disk. |
| AWorkspaceSwitchDoesNotRedirectImports | covered | `e2e/tree-file-import.spec.ts`: both `AWorkspaceSwitchDoesNotRedirectImports` tests await reader completion or a FIFO response checkpoint and assert no subsequent batch writes or stale feedback. `ui/src/useAgent.test.ts`: pending-switch, stale-callback and stale-completion tests assert no upload or listing is sent on the new binding. `server/test/file-upload.test.mjs`: `refuses an import meant for a different workspace before writing bytes` checks server-side identity enforcement independently of client timing. |
| UploadToAnExistingDirectory | covered | `server/test/file-upload.test.mjs`: `UploadToAnExistingDirectory` reads exact binary bytes, checks the reported path and observes file_changed on another real socket. |
| ImportDoesNotResurrectAMissingDirectory | covered | `server/test/file-upload.test.mjs`: `ImportDoesNotResurrectAMissingDirectory` checks not-found and absent parents; `e2e/tree-file-import.spec.ts`: `ImportDoesNotResurrectAMissingDirectory` deletes the target during FileReader and checks the visible refusal, cleared pending state and missing directory. |
| ImportCannotEscapePermissions | covered | `server/test/fileBrowser.test.ts`: `refuses read-only, non-writable and escaping targets`, `refuses a symlink escaping the root` assert refusal and absent writes, including a symlink into a non-writable subtree. `server/test/file-upload.test.mjs`: `ImportCannotEscapePermissions` checks wire reasons. |
| UploadInsideWritableZone | covered | `server/test/file-upload.test.mjs`: `stores an uploaded file, answers with its path and tells open trees` asserts bytes, reply and observer notification. |
| UploadPreservesBinaryContent | covered | `server/test/fileBrowser.test.ts`: `stores a binary payload byte-identically and reports the written path` asserts NUL and high bytes survive. |
| ReopeningFilesKeepsAnImport | covered | `e2e/tree-file-import.spec.ts`: Monkey closes and reopens Files during a held read and verifies progress and a single import. |
| UploadOutsideWritableZone | covered | `server/test/fileBrowser.test.ts`: `refuses a read-only sandbox`, `refuses a destination outside the writable zone` assert denied and no file. |
| UploadOutsideRoot | covered | `server/test/fileBrowser.test.ts`: `refuses a destination that climbs out of the root`, `refuses a destination reached through a symlink out of the root` assert outside-root and no file. |
| UploadedNameIsNotAPath | covered | `server/test/fileBrowser.test.ts`: `refuses a name that is a route rather than a name` checks empty, whitespace, dot, parent, slash, backslash and control-character names. |
| UploadedNameIsPortable | covered | `server/test/fileBrowser.test.ts`: `refuses names another platform would resolve to something else` checks trailing dots/spaces, colon, device names and overlong components. |
| UploadDoesNotOverwrite | covered | `server/test/fileBrowser.test.ts`: `does not overwrite a taken name: it suffixes and reports what it wrote` checks three distinct names and retained original contents. |
| UploadCreatesMissingDirectories | covered | `server/test/fileBrowser.test.ts`: `creates the uploads directory when it does not exist` checks creation and returned path in default attachment mode. |
| UploadBeyondSizeLimit | covered | `server/test/fileBrowser.test.ts`: wire-cap and decoded-size tests assert too-large and no file; `retains size and portable-name checks for explicit imports` checks the new mode. |

Additional transition coverage: `e2e/tree-file-import.spec.ts`'s `Monkey` test double-drops while
FileReader is held, collapses the folder, then verifies one upload and one file. Existing
`ui/src/components/FileTree.test.tsx` move/copy tests retain internal drag behaviour. The hook tests
also verify symlink-alias refresh and continuing across a session replacement with unchanged scope.

Additional unit coverage checks server refusal followed by success, a later retry, stopping the remaining batch after a workspace change, hover cleanup and sidebar containment across the whole external drag lifecycle.
