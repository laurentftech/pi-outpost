## Why

Previewing a file and then discussing it with the chatbot currently require a second, manual attachment step. The active preview should become the conversation context automatically so users can immediately ask about the file they are viewing.

## What Changes

- Automatically add the currently previewed file to the composer attachment list when the file viewer opens.
- Send a previewed text file as an `@path` reference rather than inlining its content: the agent browses the same root and can read the file itself, so the prompt no longer carries up to 512 KB of text the user may never ask about. Images still travel as image attachments, and text files dropped into the composer are still inlined (the agent cannot read those from disk).
- Let the user reference any file straight from the file tree, without opening its preview.
- Keep the automatic attachment synchronized with the previewed file, without duplicating an already attached file or a path the user typed as an `@` mention.
- Make it possible for users to remove the automatically added attachment before sending.

## Capabilities

### New Capabilities

- `preview-file-attachments`: Automatically associate an opened file preview with the next chat prompt, and let the file tree reference any file by path.

### Modified Capabilities

- `file`: Opening a file preview also exposes that file as a removable composer attachment, and the file tree offers a per-file reference toggle.
- `agent`: Prompt sending includes the file automatically attached from the active preview — text files as `@path` references, images as image attachments.

## Impact

- Frontend file-viewer and application composition in `web/src/components/FileViewer.tsx` and `web/src/App.tsx`.
- Composer attachment state and prompt construction in `web/src/components/Composer.tsx` and `web/src/attachments.ts`.
- File tree and sidebar reference toggle in `web/src/components/FileTree.tsx` and `web/src/components/Sidebar.tsx`.
- Existing `file` and `agent` OpenSpec contracts.
