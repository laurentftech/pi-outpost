# Import files by dropping them on a workspace folder

## Why
External files dropped on the app become chat attachments. Dropping them on a folder in the
file tree should instead import their bytes into that folder, without adding a message attachment.

## What Changes
- Writable folder rows and a workspace-root target accept one or several external files.
- Imports show their pending state, actual saved names and per-file refusals in the tree.
- Existing names are disambiguated without overwriting; folders and files over 25 MiB are refused.
- An explicit upload mode targets an existing confined writable directory. Composer uploads
  remain pinned to uploads and may create that directory; tree imports never create missing parents.
- Reading files for an old workspace cannot send them into a newly selected workspace.

## Impact
FileTree, Sidebar, App, useAgent, upload_file protocol and fileBrowser; no new dependency.
