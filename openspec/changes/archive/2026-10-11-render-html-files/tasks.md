# Tasks

## 1. The page

- [x] 1.1 `preparePage` (`ui/src/util/htmlPage.ts`): parse, find relative references, fetch each
  once, write them in; add the link script. Verify with unit tests (jsdom): stylesheets with their `url()`,
  pictures, `srcset`, scripts, a missing file left as it is, absolute and `data:` references untouched,
  no `/files/raw` and no token in the result.
- [x] 1.2 `HtmlPageFrame` (`ui/src/components/`): the sandboxed frame, the message check.

## 2. The viewer

- [x] 2.1 `FileViewer`: HTML is renderable — rendered, source, split — like Markdown.
- [x] 2.2 e2e in the running app: `AnHtmlReportOpensRendered`, `ThePageCannotReachTheApplication`,
  `ARelativeLinkOpensInTheViewer`, `HtmlIsEditedBesideItsRendering`; then try to break it (bench).

## 3. Docs and checks

- [x] 3.1 `README.md`; `scenario-coverage.md`, `npm run check:scenarios`, `openspec validate --strict`.
