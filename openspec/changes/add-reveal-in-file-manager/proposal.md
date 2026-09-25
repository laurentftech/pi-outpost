# Show a file or folder in the system's file manager

## Why

The Files tree can open a file with its associated application (↗), but not show *where* it is:
to attach it to an e-mail, move it with other files, or open its folder in another program, the
user has to find the same path again by hand in Finder, Explorer or their Linux file manager.
Every desktop editor offers this as *Reveal in Finder* / *Show in Explorer* / *Open containing
folder*.

## What Changes

- A **Show in file manager** control on every file and folder row of the Files tree.
- The server asks the host's file manager to show the item, selected in its folder:
  - macOS: `open -R <path>` (Finder);
  - Windows: `explorer.exe /select,<path>`;
  - Linux and other Unix: the `org.freedesktop.FileManager1.ShowItems` D-Bus method (Nautilus,
    Dolphin, Nemo, Thunar…), and when no file manager answers it, `xdg-open` on the containing
    folder.
- Confined like native opening: only an existing file or folder inside the browser root, no
  shell, and a failure is reported on the tree.
- Protocol: a `reveal_native` client message, answered like `open_native`.
- **Fix, Windows: opening a file with its application did nothing and reported an error.** The
  launcher was started with `windowsHide`, which libuv turns into `wShowWindow = SW_HIDE`;
  `explorer.exe`, a GUI program, passes that on, so the document opened hidden or not at all. Its
  non-zero exit code — Explorer's usual one — was then reported as a failure. Launchers are no
  longer started hidden, and on Windows only a failure to start Explorer is an error.

## Impact

- `file` gains a requirement; `api` gains the message.
- Server: `fileBrowser.ts` (`revealPathNative`), a handler in `index.ts`.
- UI: `FileTree.tsx` (the control), `useAgent.ts` (`revealNative`), wiring through `Sidebar` and
  `App`.
- No new dependency. The file manager opens on the machine the server runs on — the same rule as
  opening a file with its application.
