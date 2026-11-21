# Draft — microsoft/mxc issue (not posted; for the user to approve)

**Title:** ProcessContainer (BaseContainer): a rename relative to a directory handle (`NtSetInformationFile`, `RootDirectory`) fails with STATUS_INVALID_HANDLE

**Body:**

Inside a process container, renaming a file with `NtSetInformationFile(FileRenameInformation[Ex])` fails
with `STATUS_INVALID_HANDLE` (`0xC0000008`) whenever the new name is given relative to a directory handle
(`RootDirectory` set). The same rename with an absolute `\??\C:\…` name succeeds, and outside the
container both succeed.

**Environment:** Windows 11 24H2 10.0.26100.9711, `wxc-exec.exe` / `@microsoft/mxc-sdk` 1.1.0, tier
`base-container`, unelevated. The folder is in `readwritePaths`.

**Reproduction:** `scripts/probes/mxc-handle-relative-rename.ps1` in pi-outpost (a self-contained
PowerShell script compiling a small C# helper): it opens the directory
(`FILE_LIST_DIRECTORY | FILE_TRAVERSE | SYNCHRONIZE`), creates `a.tmp`, opens it with `DELETE`, and renames
it to `b.tmp`.

| Rename | outside | inside the container |
|---|---|---|
| `FileRenameInformationEx`, `POSIX_SEMANTICS \| IGNORE_READONLY_ATTRIBUTE`, `RootDirectory` = dir handle | `0x00000000` | **`0xC0000008`** |
| `FileRenameInformationEx`, no flags, `RootDirectory` | `0x00000000` | **`0xC0000008`** |
| `FileRenameInformation` (legacy), `RootDirectory` | `0x00000000` | **`0xC0000008`** |
| either class, absolute `\??\C:\…\b.tmp`, no `RootDirectory` | `0x00000000` | `0x00000000` |

**Impact:** bun's package manager probes its cache this way (`renameat` → `move_opened_file_at`), so
`bun install` / `bun add` cannot run in a container at all ("EBADF accessing temporary directory"), whatever
cache and temporary folders it is given. Win32 `MoveFileEx`, used by Node, Go, Rust and .NET, is unaffected.

**Expected:** a handle-relative rename within writable paths behaves as it does outside the container.

Possibly the same family as #1464 (handle-based path queries), which the October cumulative update fixed.
