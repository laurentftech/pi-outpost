## Context

`openFileNative` (`server/src/fileBrowser.ts`) already opens a confined file with the platform
launcher, without a shell, and the tree shows a failure through the generic file-operation error.
Showing an item in the file manager is the same shape with a different command per platform.

## Decisions

### 1. The command per platform

| Platform | Invocation | Source |
|---|---|---|
| macOS | `open -R <path>` — reveals in Finder instead of opening | `open(1)`; Playwright's `reveal` does the same |
| Windows | `explorer.exe` with arguments `/select,` and `<path>` | Playwright's `reveal` (`execFile("explorer", ["/select,", path])`) |
| Linux, other Unix | `dbus-send --session --print-reply --dest=org.freedesktop.FileManager1 --type=method_call /org/freedesktop/FileManager1 org.freedesktop.FileManager1.ShowItems array:string:<file URI> string:` | Chromium's `ShowItemInFolder` on Linux calls this method (`ShowItems`, signature `as s`: file URIs, startup id) |
| — fallback | `xdg-open <containing folder>` when the D-Bus call fails (no `dbus-send`, no file manager implementing the interface, no session bus) | Chromium falls back to opening the parent folder; Playwright does only this |

The file URI is built with `pathToFileURL`; a comma in it is percent-encoded, because `dbus-send`
splits an `array:string:` value on commas.

### 2. Explorer's exit code is not a result

`explorer.exe` returns a non-zero exit code even when it has opened the window. On Windows the
reveal is therefore successful once the process starts; only a failure to start it is reported.
On macOS and for `dbus-send`, a non-zero exit is a failure (and on Linux triggers the fallback).

### 3. Files and folders, confined

The path must resolve inside the browser root (`resolveConfined`) and exist, as a file or a
directory. A folder is shown selected in its parent, as Finder and Explorer do. Nothing needs to be
writable. The control is on every file and folder row; the tree root has no row and no control.

### 4. Where it opens

On the machine the server runs on, like `open_native`. For a remote browser this opens a window
nobody sees, which is the existing rule for native opening, not a new exposure: the operation only
shows a path the tree already lists.
