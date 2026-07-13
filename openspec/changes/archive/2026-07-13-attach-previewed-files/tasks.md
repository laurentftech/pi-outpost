## 1. Attachment model and preview conversion

- [x] 1.1 Extend the composer attachment model with preview provenance and a preview-path identity.
- [x] 1.2 Add a tested conversion path from loaded text previews to path-reference attachments (review outcome: inlining the snapshot spent context proportional to file size).
- [x] 1.3 Add a tested conversion path from previewed image raw bytes to bounded image attachments, preserving authentication support.

## 2. Preview-to-composer synchronization

- [x] 2.1 In `App`, derive one automatic attachment from the successfully active file preview without duplicating manual attachments.
- [x] 2.2 Replace only the prior automatic attachment when the active preview path changes.
- [x] 2.3 Preserve a user removal of the active preview attachment until another file becomes the active preview.
- [x] 2.4 Surface non-blocking errors when an automatic attachment cannot be created while keeping the preview available.

## 3. Prompt delivery and verification

- [x] 3.1 Build the sent prompt in a tested pure function: path references become `@path` mentions, dropped text files stay inline, images ride as WireImage values.
- [x] 3.2 Skip a mention the typed prompt already carries, so a path referenced twice is sent once.
- [x] 3.3 Add frontend tests for preview attachment creation, deduplication, replacement, removal, unreadable images, and prompt composition.
- [x] 3.4 Run the relevant web test suite and TypeScript checks, then verify the OpenSpec change is apply-ready.

## 4. Reference files from the tree

- [x] 4.1 Add a per-file reference toggle to the file tree that adds or removes a manual path attachment without opening the preview.
- [x] 4.2 Show referenced files as active in the tree, and dedupe a tree reference against the preview's own reference.
- [x] 4.3 Light the tree's reference pin for paths the draft names with `@` too (composer reports its mentions upward), and keep the pin itself hover-only where hover exists.
