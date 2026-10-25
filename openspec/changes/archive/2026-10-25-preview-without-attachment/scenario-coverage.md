# Scenario coverage

OpenLore orient and rg supplied evidence; graph tools unavailable. Main and delta scenarios enumerated with rg '^#### Scenario:' openspec/. The main automatic-attachment contracts conflict with user intent and are explicitly removed by this delta; their scenarios are retired, not silently treated as still passing.

| Applicable scenario | Status | Test file and test name | Assertions |
| --- | --- | --- | --- |
| OpenFilesWithoutAttaching | covered | `ui/src/App.test.tsx`: OpenFilesWithoutAttaching (seven file types); `scripts/probes/preview-attachments.mjs` | Composer empty after opening text/image/PDF/Word; actual WS prompt is exactly Continue sans fichier with no images. |
| PreserveExplicitAttachmentsWhileBrowsing | covered | `App.test.tsx`: PreserveExplicitAttachmentsWhileBrowsing; `preview-attachments.mjs` | Manual pin remains through file changes, refresh and close. Real widget checks one chip and sent @preview-a.md only. Rapid switches and PDF close during loading leave no implicit context or page errors. |
| ExplicitReferencesStillWork | covered | `App.test.tsx`: references a file pinned in the tree, and drops it when unpinned; `Composer.test.tsx`: attaches files pasted into the box; `attachments.test.ts` upload cases | Explicit tree pins, file import and prompt serialization retain their contracts. |
| User references a file from the tree | covered | `App.test.tsx`: references a file pinned in the tree, and drops it when unpinned; `preview-attachments.mjs` | Pin state and actual prompt reference asserted. |
| Draft mentions a file by hand | covered | `ui/src/components/Composer.test.tsx`: reports the mentioned paths so the app can attach them; `FileTree.test.tsx` reference cases | Mentioned paths report to tree; existing explicit control remains. |
| A file is referenced twice | covered | `Composer.test.tsx`: does not mention the path twice when the draft already names it | Sent prompt has one reference. |

## Retired main scenarios

Text preview becomes a path reference; PDF preview becomes a path reference; Image preview becomes an attachment; Same preview rerenders; User previews another file; User removes the preview attachment; Oversized image preview; Large text preview; Tool-readable binary selection becomes a path reference; Unsupported binary selection is not attached automatically. Their automatic behavior is superseded by the three negative/explicit scenarios above. Reference files from the file tree remains unchanged.

## Verification

298 focused UI tests pass (App, attachments, FileTree, Composer). Embed TypeScript/production build passes. Real widget Playwright probe passes for text/image/PDF/Word, explicit pin preservation and rapid preview transitions, and reads outgoing WS frames without sending prompts to a model. No page errors. Strict OpenSpec validation passes. README documents preview versus explicit context.
