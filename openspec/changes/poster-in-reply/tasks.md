# Tasks

- [x] `isPosterFile` in `ui/src/util/workspacePath.ts`; `FileViewer`'s `isPoster` delegates to it.
- [x] `ui/src/components/markdownPoster.tsx`: `isWorkspacePoster`, `workspacePosterPath`, `containsPoster`.
- [x] `ui/src/components/PosterBlock.tsx`: read-only sandboxed poster block for replies.
- [x] Wire into `AssistantMessage.tsx` (`img` renders the block; `p` unwraps when a poster is inside).
- [x] Tests in `AssistantMessage.test.tsx` covering the scenarios below.
- [x] `scenario-coverage.md` maps each scenario to its test.
