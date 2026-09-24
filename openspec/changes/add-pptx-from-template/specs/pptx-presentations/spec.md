## ADDED Requirements

### Requirement: ListTemplateLayouts

The system SHALL provide a `pptx_layouts` tool that, given a PowerPoint template (`.potx`) or
presentation (`.pptx`), returns its slide size, the number of slides it holds of its own, and its
slide layouts in the order its masters declare them — each with its name, its layout type, and the
placeholders it offers, named for what they hold (title, subtitle, content, text, picture).

A layout placeholder that states no position of its own SHALL be given the position of the master
placeholder it inherits from, as PowerPoint does.

A file that is not a usable template — not an Office package, encrypted or a legacy binary file,
macro-enabled, damaged, or declaring a DOCTYPE — SHALL be refused with the reason.

#### Scenario: LayoutsAreListedInTheMastersOrder
- **WHEN** `pptx_layouts` is called on a template
- **THEN** it lists every layout in the master's declared order, with its name, type and placeholders

#### Scenario: APlaceholderWithoutPositionInheritsTheMasters
- **GIVEN** a layout whose content placeholder carries no transform
- **WHEN** the template is read
- **THEN** that placeholder has the position of the master's body placeholder

#### Scenario: AnUnusableTemplateIsRefusedWithItsReason
- **WHEN** the file is encrypted, not a zip, not a presentation, macro-enabled or declares a DOCTYPE
- **THEN** the call fails with a message saying which

### Requirement: BuildADeckFromATemplate

The system SHALL provide a `pptx_create` tool that writes a new `.pptx` from a template and an
ordered list of slides. Each slide MAY name a layout, and MAY carry a title, a subtitle, bullets and
one picture.

Content SHALL be written into the layout's placeholders — a slide shape referencing the layout
placeholder's type and index — so that the template's styling applies to it.

Bullets SHALL be one paragraph each; leading indentation (two spaces or one tab per level) SHALL set
the nesting level, and a leading bullet glyph typed into the text SHALL be removed so that bullets
are not drawn twice. `**text**` SHALL become bold.

When no layout is named, one SHALL be chosen from the slide's content by layout type: a cover for a
first slide without body, a section header or title-only layout for a later one, a content layout
for bullets or a picture, and a two-content layout for both. A named layout SHALL be matched by name
without regard to case, or by its number in the listing; an unknown name SHALL be refused with the
list of layout names.

Content a layout has no placeholder for SHALL NOT be dropped silently: the result SHALL say, per
slide, what was left out.

The output SHALL be a presentation, whatever the template was: its main part declared with the
presentation content type. The template's own slides SHALL NOT be carried over, and neither SHALL
any part that only they reached; custom shows and section lists naming them SHALL be removed. Every
relationship in the output SHALL resolve to a part it contains, and every part SHALL have a content
type.

#### Scenario: SlidesFillTheLayoutsPlaceholders
- **WHEN** a slide with a title and bullets is created on a layout with a title and a content placeholder
- **THEN** the slide holds shapes referencing those placeholders by type and index, carrying the text

#### Scenario: TheOutputIsAPresentationNotATemplate
- **GIVEN** a `.potx` template
- **WHEN** a deck is created from it
- **THEN** the output's main part is declared as a presentation, and nothing in it is declared as a template

#### Scenario: TheTemplatesOwnSlidesAreLeftOut
- **GIVEN** a template holding a sample slide with its own notes and picture, named by a custom show and a section
- **WHEN** a deck is created
- **THEN** the output holds only the new slides, the sample's notes and picture are gone, and no custom show or section list names a slide

#### Scenario: EveryRelationshipResolves
- **WHEN** a deck is created
- **THEN** every relationship in it points at a part it contains, and every part has a content type

#### Scenario: BulletsNestByIndentation
- **WHEN** bullets are indented by two spaces per level, and one begins with a typed bullet glyph
- **THEN** each becomes a paragraph at its level, and no glyph is typed into the text

#### Scenario: ALayoutIsChosenFromTheContentWhenNoneIsNamed
- **WHEN** slides name no layout
- **THEN** a cover, a content, a two-content, a section header and a title-only layout are chosen according to what each slide holds

#### Scenario: AnUnknownLayoutIsRefusedWithTheList
- **WHEN** a slide names a layout the template does not have
- **THEN** the call fails, naming the layout and listing the template's layout names

#### Scenario: WhatALayoutCannotHoldIsReported
- **WHEN** a slide carries a title, subtitle or bullets its layout has no placeholder for
- **THEN** the result says, for that slide, what was left out

### Requirement: PicturesKeepTheirProportions

A picture SHALL be read as PNG, JPEG, GIF or SVG from its bytes, not its name, and placed at the
largest size of its own proportions that fits its area, centred in it. The area SHALL be the
layout's picture placeholder when it has one; otherwise a second content placeholder when the slide
also has bullets; otherwise the content placeholder, shared with the bullets — text on the left,
picture on the right — when both must fit in one.

An SVG SHALL be embedded as SVG through the Office 2016 SVG extension, with a raster rendering of it
as the picture every other reader draws. When no rasteriser is available, the fallback SHALL be an
empty picture and the result SHALL say so. An SVG that refers to anything outside itself, or that
declares a DOCTYPE, SHALL be refused.

#### Scenario: APictureFitsItsBoxWithoutStretching
- **WHEN** a picture of one proportion is placed in an area of another
- **THEN** it keeps its proportion and is centred in the area

#### Scenario: PictureGoesToThePicturePlaceholder
- **WHEN** a picture is placed on a layout with a picture placeholder
- **THEN** it is fitted inside that placeholder's area

#### Scenario: TextAndPictureShareAContentPlaceholder
- **WHEN** a slide with bullets and a picture uses a layout with one content placeholder
- **THEN** the bullets take its left part and the picture its right part

#### Scenario: SvgIsEmbeddedWithARasterFallback
- **WHEN** an SVG picture is placed
- **THEN** the slide references the SVG through the SVG extension and a PNG as the fallback picture, both present in the package

#### Scenario: AnSvgReachingOutsideItselfIsRefused
- **WHEN** an SVG refers to a URL, a file, or a stylesheet outside itself
- **THEN** the slide is refused, naming the picture

### Requirement: NativeTablesAndCharts

A slide MAY carry a table or a chart instead of a picture; a slide SHALL carry at most one picture,
table or chart, and a slide asking for more SHALL be refused. A table or chart SHALL take the place a
picture would, except that it SHALL NOT be put into a picture placeholder.

A table SHALL be a native PowerPoint table filling its area's width, in the default table style so
that the template's theme colours it, with the first row marked as its header unless the slide says
otherwise. Cells holding figures SHALL be right-aligned, headers excepted. Its text size SHALL
decrease with its number of rows so that it fits its area. A table without rows, with rows of
unequal length, with more than 20 rows or 10 columns, or with a cell over 500 characters SHALL be
refused, naming the slide.

A chart SHALL be a native chart part of type column, bar, line or pie, whose series take the theme's
accent colours in order (a pie's slices likewise), whose values are cached in the part, and whose
data is embedded as a workbook linked from the part, laid out where the part's cell references
point, so that the chart can be edited in PowerPoint. Column and bar series MAY be stacked; a number
format MAY apply to the values and their labels; values MAY be written on the chart, without a
label position, which some chart types refuse. A legend SHALL be shown for more than one series and
for a pie. The markup SHALL follow the schema's element order for every chart type. A chart with an
unknown type, no categories or series, a series whose length differs from the categories, a value
that is not a finite number, a pie with more than one series or a negative value, or a stacked line
or pie SHALL be refused, naming the slide.

Chart and workbook part names SHALL NOT collide with parts the template keeps.

#### Scenario: TablesAreNativeAndStyledByTheTemplate
- **WHEN** a slide carries a table
- **THEN** the slide holds a native table filling its area's width, in the default table style, with its first row marked as the header, and the extractor reads the table back

#### Scenario: FiguresInATableAreRightAligned
- **WHEN** a table holds figures and words
- **THEN** the cells holding figures are right-aligned and the header and words are not

#### Scenario: AnUnreadableTableIsRefused
- **WHEN** a table has no rows, unequal rows, more than 20 rows or 10 columns, or an overlong cell
- **THEN** the call fails, naming the slide and the reason

#### Scenario: ChartsAreNativeWithTheirDataEmbedded
- **WHEN** a slide carries a chart
- **THEN** the package holds a chart part related from the slide, declared with the chart content type, whose workbook relationship resolves to an embedded workbook holding the categories and series where the chart's references point

#### Scenario: ChartsTakeTheThemesColours
- **WHEN** a chart is written
- **THEN** its series, or a pie's slices, are filled with the theme's accent colours and no fixed colour

#### Scenario: EachChartTypeFollowsTheSchemaOrder
- **WHEN** a column, stacked bar, line or pie chart is written
- **THEN** its elements appear in the schema's order, a stacked chart overlaps its series, a pie has no axes, and value labels name no position

#### Scenario: InvalidChartDataIsRefused
- **WHEN** a chart's type, categories, series or values cannot be charted
- **THEN** the call fails, naming the slide and the reason

#### Scenario: OneVisualPerSlide
- **WHEN** a slide carries two of a picture, a table and a chart
- **THEN** the call fails, telling the caller to put them on separate slides

#### Scenario: ChartNamesNeverCollideWithTheTemplates
- **GIVEN** a template that keeps a chart and a workbook of its own
- **WHEN** a deck with a chart is created from it
- **THEN** the template's parts are unchanged and the new chart and workbook take names not in use

### Requirement: CreationIsConfinedAndNonDestructive

The template and every picture SHALL be read only from inside the readable zone, and the output
written only inside the writable zone; each path argument SHALL be checked after symbolic links are
resolved. The output SHALL end in `.pptx`. An existing file SHALL be replaced only when the call asks
for it, and then whole. Where writing is disabled, `pptx_create` SHALL NOT be offered at all.

#### Scenario: SourcesOutsideTheReadableZoneAreRefused
- **WHEN** the template or a picture lies outside the sandbox, directly or through a symbolic link
- **THEN** the call fails and nothing is written

#### Scenario: OutputOutsideTheWritableZoneIsRefused
- **WHEN** the output path lies outside the writable zone, or does not end in `.pptx`
- **THEN** the call fails and nothing is written there

#### Scenario: AnExistingDeckIsReplacedOnlyWhenAsked
- **GIVEN** a deck already at the output path
- **WHEN** a deck is created there without asking to overwrite, and then again asking to
- **THEN** the first call fails and the second replaces the whole deck

#### Scenario: NoBuilderInAReadOnlySandbox
- **GIVEN** a sandbox that does not allow writing
- **WHEN** the toolset is built
- **THEN** it offers `pptx_layouts` and `pptx_render` but not `pptx_create`

### Requirement: RenderADeckForReview

The system SHALL provide a `pptx_render` tool that has an office application draw a deck and returns,
for the slides asked for (at most twelve per call), a picture of each slide, together with a text
check covering every slide asked for: each paragraph on a slide that is not fully visible on its
rendered page, and text drawn at the page's edge. The result SHALL name the application that drew
the deck, and, when it is not PowerPoint, say that fonts may be substituted.

With the choice `auto`, the applications SHALL be tried in this order: PowerPoint through COM
automation on Windows, then LibreOffice, then ONLYOFFICE Document Builder. A converter that cannot
run SHALL be skipped and the result SHALL say why; when none can, the call SHALL fail, listing each
attempt and what to install. A named converter SHALL be the only one tried.

The converter SHALL work on a copy of the deck in a private temporary directory, which SHALL be
removed afterwards. No path SHALL be spliced into a shell command or script text that is executed
as code, except as an escaped string literal. PowerPoint SHALL be asked to quit only when no
presentation is left open in it.

Stopping the turn SHALL stop the rendering: the running converter SHALL be terminated, and no
further converter SHALL be started.

The rendering MAY be saved as a PDF at a path inside the writable zone that does not exist yet.

#### Scenario: SlidesComeBackAsPictures
- **WHEN** a deck is rendered
- **THEN** the result holds one PNG picture per slide asked for, each labelled with its slide number

#### Scenario: OverflowingTextIsReported
- **GIVEN** a slide whose last paragraphs run past its bottom edge in the rendering
- **WHEN** the deck is rendered
- **THEN** the text check names that slide and those paragraphs, and no other slide

#### Scenario: PowerPointIsPreferredOnWindows
- **GIVEN** a Windows machine
- **WHEN** a deck is rendered with the choice `auto`
- **THEN** PowerPoint is tried first, through PowerShell, with the paths passed outside the script text

#### Scenario: FallsBackWhenAConverterIsUnavailable
- **GIVEN** PowerPoint cannot be automated and LibreOffice is installed
- **WHEN** a deck is rendered with the choice `auto`
- **THEN** LibreOffice renders it and the result says why PowerPoint was skipped

#### Scenario: NoConverterIsReportedWithWhatToInstall
- **GIVEN** no office application is available
- **WHEN** a deck is rendered
- **THEN** the call fails, listing each converter tried and telling the user what to install

#### Scenario: TheConverterNeverTouchesTheUsersFile
- **WHEN** a deck is rendered
- **THEN** the converter is given a copy in a private directory, and that directory is gone afterwards

#### Scenario: StoppingTheTurnStopsTheRendering
- **WHEN** the turn is stopped while a converter is running
- **THEN** that converter's process is terminated and no other converter is started

#### Scenario: TheRenderingCanBeSavedAsPdf
- **WHEN** a deck is rendered with a PDF path inside the writable zone
- **THEN** the PDF is written there, and a path that exists or lies outside the zone is refused

#### Scenario: PowerPointIsNotClosedUnderTheUser
- **WHEN** PowerPoint renders a deck
- **THEN** it opens the copy read-only and without a window, and quits only if no presentation remains open

### Requirement: SkillTeachesTheRenderAndFixLoop

The product SHALL ship a skill, `pptx-from-template`, that teaches the agent to read the template's
layouts, plan the deck, create it, render it, fix what the rendering shows and render again, and
never to call a deck finished without having rendered it.

#### Scenario: TheSkillShipsWithTheProduct
- **WHEN** the skills shipped with the product are listed
- **THEN** `pptx-from-template` is among them, names the three tools, and requires a rendering before the deck is called finished
