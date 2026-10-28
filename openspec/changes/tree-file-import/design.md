# Tree file import

The existing upload_file wire operation is reused with an optional existingDirectory flag.
Without it, the attachment path remains pinned to uploads and can create its parents. With it,
the server first checks the expected workspaceId against the socket's actual binding, then
resolveWritableDirectory validates a real directory before the existing size/name/base64,
re-confinement, exclusive temporary-file and hard-link collision-safe writer runs. Imports never
create parents, so deleting a target during a read cannot silently recreate it.

FileTree owns one serial batch, with a synchronous latch against duplicate drops. It accepts
all file formats, checks 25 MiB before FileReader, skips directory entries with an explanation,
and retains both successful saved paths and per-file failures. The target folder opens on drop.
Sidebar contains external drag events so rejected imports cannot become composer attachments;
entering it clears the global attachment overlay. Root imports have an explicit target.

useAgent's existing upload callback accepts an optional directory. Directory imports capture an
upload generation, invalidated by binding requests, connection loss and snapshots that change
workspace identity, browser root or writable zone. A switch in progress is also refused. A reply
for an old generation cannot refresh a directory in the new project or continue its batch.
Changing sessions with the same filesystem scope does not cancel an import. A completed import
refreshes its chosen path as well as the normal file_changed broadcast, because a symlink alias
can differ from the canonical saved path. The sidebar is keyed by workspace and browser root,
so old feedback never appears under a different tree.

No LLM turn or attachment is created. Requests already accepted by the server may finish in their
original workspace; they never change destination after a client switch.
