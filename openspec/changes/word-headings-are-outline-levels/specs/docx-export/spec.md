## ADDED Requirements

### Requirement: HeadingsAreChapterLevels

The heading styles an exported document uses SHALL declare the outline level of their
heading level — level 0 for a first-level heading through level 5 for a sixth-level one —
so that Word's navigation pane, table of contents and heading numbering treat the headings
as the document's chapters. Declaring the level MUST NOT remove the style's own
formatting, and body text MUST NOT be given an outline level.

#### Scenario: HeadingsAreChapterLevels
- **GIVEN** a Markdown document with headings at several levels and body text
- **WHEN** it is exported
- **THEN** each of the Heading 1–6 styles in the document declares the outline level one below its heading level, keeps its own run formatting, and the body-text style declares no outline level
