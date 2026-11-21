# Draft — oven-sh/bun change (not posted; for the user to approve)

**Title:** Windows: retry a handle-relative rename by absolute path when it fails with STATUS_INVALID_HANDLE

**Why:** under Microsoft's process containers (MXC, Windows 11 tier 1 — the sandbox Codex, pi-outpost and
others use), `NtSetInformationFile(FileRenameInformation[Ex])` with `RootDirectory` set fails with
`STATUS_INVALID_HANDLE`, while the same rename by absolute path succeeds (measured, and reported to MXC:
<link to the MXC issue once open>). `bun install` / `bun add` probe their cache with exactly that rename,
so they cannot run inside such a sandbox at all: `error: EBADF accessing temporary directory. set
$BUN_TMPDIR or $BUN_INSTALL`, whatever the variables say. `bun run` and `bun test` work (1.4.5).

**Change:** in `src/sys/windows/mod.rs`, `move_opened_file_at`, beside the existing retry with the legacy
class on `STATUS_INVALID_PARAMETER` (exFAT/FAT32): on `STATUS_INVALID_HANDLE`, when `RootDirectory` was a
handle, resolve that directory's path (`GetFinalPathNameByHandleW`, which works inside the container since
the October 2026 cumulative update) and retry with the absolute `\??\<dir>\<name>` and a null
`RootDirectory`. A sketch:

```rust
let mut rc = rename_as(win32::FileInformationClass::FileRenameInformationEx, flags);
if rc == win32::ntstatus::INVALID_PARAMETER {
    rc = rename_as(win32::FileInformationClass::FileRenameInformation, ULONG::from(replace_if_exists));
}
// Some sandboxes (Microsoft's process containers) refuse a name relative to a directory handle
// with STATUS_INVALID_HANDLE but accept the same rename by absolute path.
if rc == win32::ntstatus::INVALID_HANDLE && !bun_paths::is_absolute_windows_wtf16(new_file_name) {
    if let Ok(dir) = get_fd_path_w(new_dir_fd) {
        rc = rename_absolute(src_fd, &join_nt_path(dir, new_file_name), flags);
    }
}
```

**Test:** a Windows unit test cannot reproduce the container; the retry path can be exercised by
injecting the status in `rename_as` (the module already isolates the NT call), checking that the second
call carries a null `RootDirectory` and the absolute name, and that any other status is returned as
before.
