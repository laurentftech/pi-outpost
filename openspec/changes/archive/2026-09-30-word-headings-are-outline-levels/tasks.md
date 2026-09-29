# Tasks

## 1. Outline levels

- [x] 1.1 Confirm the gap on a real export: the writer's default Heading 1–6 styles carry
      run properties only, no `w:outlineLvl`.
- [x] 1.2 `buildDocx` declares `outlineLevel` 0–5 on the six default heading styles, and
      check the writer merges it with the styles' run properties.
- [x] 1.3 Test on `word/styles.xml` (`markdownStructure.test.ts`), failing without 1.2.
- [x] 1.4 In the running app: export a Markdown file to Word and read the downloaded
      file's styles.
