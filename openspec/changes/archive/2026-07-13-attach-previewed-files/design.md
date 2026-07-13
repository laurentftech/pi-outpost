## Context

The file viewer and composer currently operate independently. `FileViewer` receives an `OpenFile` from `useAgent`, while `App` owns composer attachments and uses `filesToAttachments` only for browser `File` objects. Text attachments are inlined in the prompt; images are sent as `WireImage` values. The proposed feature crosses these UI boundaries without requiring a WebSocket protocol or server change.

## Goals / Non-Goals

**Goals:**

- Make the file currently displayed in the preview available as a removable composer attachment automatically.
- Keep the prompt small: a referenced text file must not spend context window proportional to its size.
- Let the user reference a file from the tree without opening it.
- Reuse the existing `@` mention convention and the image-wire attachment path.
- Prevent duplicate attachments when the same preview is rendered more than once.

**Non-Goals:**

- Changing file-browser sandbox permissions or increasing preview/attachment limits.
- Attaching directories, diffs, unsaved editor drafts, or arbitrary binary files.
- Adding a new backend endpoint or changing the typed WebSocket protocol.

## Decisions

### Represent preview attachments as first-class composer attachments

Add attachment provenance and an optional preview path to the existing client-side `Attachment` type. `App` will derive a text attachment from a successfully loaded preview, and will use the same raw-file retrieval path already used by image previews to create image attachments when available. The resulting attachment then follows the existing `Composer` submission behavior.

This keeps prompt construction in one place and avoids duplicating protocol handling in the file viewer. Passing a new callback from `FileViewer` was considered, but deriving from `state.openFile` makes attachment creation occur only after a successful preview load and covers all file-opening entry points.

### Maintain one automatic attachment for the active preview

When the active preview path changes, replace the previous preview-origin attachment while leaving user-added attachments intact. Reopening or re-rendering the same path must not create a duplicate. If the user removes the preview-origin attachment, record that removal for the active path so ordinary state updates do not immediately restore it; opening another file resets that suppression.

Appending every opened file was considered, but it can unexpectedly grow the next prompt and makes the phrase “the file in preview” ambiguous.

### Send a previewed text file as a path reference, not as content

A previewed text file becomes a `path` attachment whose payload is its browser-root-relative path; `composePrompt` renders it as an `@path` mention appended to the typed text. Inlining the preview snapshot was implemented first and rejected on review: the file browser's root is the agent's sandbox root, so the agent can read the file with its own tools. Inlining spends prompt tokens proportional to file size — up to the 512 KiB text limit, roughly 130k tokens — on content the user may never ask about, and browsing several files would silently stack those blocks into the next prompt.

The trade-offs accepted: the agent reads the file from disk, so it sees the current bytes rather than the snapshot the user was shown (a background edit between preview and send is visible to the agent, not hidden from it), and a file whose content only exists in the viewer would not be readable — the viewer only ever shows files that live under the browser root, so that case does not arise.

Images keep travelling as base64 `WireImage` values: the agent's file tools cannot hand image bytes to the model. Text files dropped or pasted into the composer also stay inlined — they come from the user's machine and have no path inside the browser root.

### Reference files from the tree

Each file row in `FileTree` carries a link toggle that adds or removes a manual `path` attachment, so the user can build up prompt context without opening previews. Attachments dedupe by path, and `composePrompt` skips a mention the typed text already contains, so the preview reference, a tree reference, and a hand-typed `@` mention of the same file collapse to a single mention.

### Respect existing content and size constraints

Image bytes must remain within the image attachment limit. Unreadable, unsupported, or oversized image previews remain viewable but produce no automatic attachment and expose a clear non-blocking error. Path references carry no size limit — that is the point of the reference.

## Risks / Trade-offs

- [A large previewed file floods the agent's context window] → Reference the file by path; the agent reads only what it needs.
- [A background file changes after it is previewed] → Accepted: the agent reads the file at prompt time, so it acts on the current bytes, not on a snapshot that may already be stale.
- [The agent ignores an `@path` mention] → The mention is the composer's established convention for naming a file to the agent, already produced by `@` autocomplete.
- [Image retrieval fails because of authentication or network conditions] → Keep the preview usable; show an attachment error and do not send a partial image.
- [User removes an automatic attachment] → Track per-active-preview suppression so it stays removed until a different file is previewed.
- [Tree references pile up unnoticed] → Each reference shows as a removable chip, and the tree toggle stays lit for referenced files.

## Migration Plan

No data migration or deployment sequencing is needed. The change is frontend-only and can be rolled back by removing the preview-to-attachment derivation; existing manual attachment and prompt behavior remain compatible.

## Open Questions

None. The proposal treats the active preview as the single automatic attachment and preserves the user's ability to remove it.
