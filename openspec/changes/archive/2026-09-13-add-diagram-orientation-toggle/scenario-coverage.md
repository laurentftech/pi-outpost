# Scenario coverage — add-diagram-orientation-toggle

Every scenario the delta declares, and the assertion that would fail if its contract
broke. A scenario is `covered` only when a test's *assertions* — not its name — check
the GIVEN/WHEN/THEN at the boundary the scenario describes.

Two boundaries carry most of this. The rule itself is arithmetic and is tested with no
diagram at all; the graph figure is tested under Node, with no browser anywhere, because
that is the environment the agent's own figures are produced in. Only what needs a
mounted component — which control appears, what both copies of a rendering show, what
the clipboard receives — is tested in jsdom.

Capability: `diagram-orientation` (18 scenarios).

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AWideDiagramIsTurned | covered | `server/test/structuredExchangeFigureOrientation.test.ts` — "a graph far too wide to be read across is turned" asserts `figure.orientation === "portrait"` for a twelve-box chain with no orientation passed; `ui/src/components/Mermaid.orientation.test.tsx` — "draws it the other way when the authored direction does not fit" asserts the second source handed to mermaid is the turned one |
| ASmallDiagramIsLeftAlone | covered | `server/test/structuredExchangeFigureOrientation.test.ts` — "a graph that fits the reading width is drawn landscape" asserts both the orientation and that the figure really is within `READING_WIDTH`; `ui/src/components/Mermaid.orientation.test.tsx` — "keeps the authored direction when what it draws fits" asserts mermaid was called exactly once |
| TheChoiceDoesNotDependOnTheWindow | covered | `server/test/diagramOrientation.test.ts` — the predicate takes two widths and no viewport; `server/test/structuredExchangeFigureOrientation.test.ts` runs the whole choice under Node where no window exists at all, and reaches the same verdicts the jsdom tests do for the same graphs |
| TheChoiceIsDeterministic | covered | `server/test/diagramOrientation.test.ts` — "the same widths give the same answer every time" collects 50 answers into a set and asserts it has one member; `server/test/structuredExchangeFigureOrientation.test.ts` — "the choice is the same every time it is made" does the same over five whole figures |
| TheReaderTurnsADiagram | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "turns the diagram, and offers to turn it back" asserts the boxes move from sharing a row to sharing a column and back, and that the control names the orientation it would switch to; "names what the click would do, not what is already on screen" pins the label and the title |
| TheReaderOverridesTheAutomaticChoice | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "overrides the automatic choice" turns an auto-turned graph back and asserts it stays back; "turns twice on a double click rather than computing the same answer twice" pins the toggle against a batched double click; `ui/src/components/Mermaid.orientation.test.tsx` — "overrides a diagram the system turned, and stays overridden" re-arms the stub to answer wide and asserts the authored source is what is drawn |
| TurningStartsFromTheComputedLayout | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "starts the arrangement again rather than carrying offsets across" drags a box (asserting the drag registered), turns, and asserts the offer to reset the layout is gone because no offsets survive |
| SwitchingDoesNotAlterTheDocument | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "leaves the document itself untouched" asserts the item's `structured` payload is character-for-character the producer's after turning |
| AnUnreadableAuthoredDirectionIsOverridden | covered | `ui/src/components/Mermaid.orientation.test.tsx` — "draws it the other way when the authored direction does not fit" (a source stating `LR`, drawn `TB`) and "turns a source authored down the page, when across is what fits" (the same in reverse) |
| AReadableAuthoredDirectionIsKept | covered | `ui/src/components/Mermaid.orientation.test.tsx` — "keeps the authored direction when what it draws fits", and "keeps the authored direction when turning would not actually help" for the overflowing case that gains nothing |
| AnOverriddenDiagramSaysSo | covered | `ui/src/components/Mermaid.orientation.test.tsx` — "says on the block that it is not drawn the way its source asks" asserts the note names the authored orientation, and "says nothing when it is drawn as written" asserts the note is absent otherwise |
| TheAuthoredSourceIsWhatTheReaderGets | covered | `ui/src/components/Mermaid.orientation.test.tsx` — "still shows and copies the source the agent wrote" asserts the `<pre>` is the authored string exactly and that the clipboard receives it, for a diagram that was re-oriented |
| ASequenceOffersNoOrientation | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "offers nothing on a sequence, whose lifelines run one way only"; `ui/src/components/Mermaid.orientation.test.tsx` — "draws a sequence exactly as written, however wide it is" asserts one render and no control for a `sequenceDiagram` answering 2400px |
| ATableOffersNoOrientation | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "offers nothing on a table" |
| ANotationWithNoDirectionIsLeftAlone | covered | `ui/src/components/mermaidDirection.test.ts` — "a notation with no direction to choose is left alone" asserts `undefined` for sequence, pie, gantt, class, ER, journey and gitGraph, for an unrecognised notation, and for unclosed frontmatter; `ui/src/components/Mermaid.orientation.test.tsx` proves the component then renders the source untouched |
| TheSameContentEitherWay | covered | `server/test/structuredExchangeFigureOrientation.test.ts` — "the same elements are drawn either way", "the same labels and the same key are drawn either way" (text compared as a multiset), "the same relationships are drawn either way", "what a screen reader is told does not depend on which way it was drawn", and "the picture actually moved onto the other axis" so the three above cannot pass vacuously |
| NarrowingSurvivesTheTurn | covered | `server/test/structuredExchangeFigureOrientation.test.ts` — "it still says it is showing less than the whole document" asserts `figure.narrowing` survives in both orientations, and "both orientations hide exactly the same things" compares the drawn elements and the narrowing statement |
| TheExportIsWhatIsShown | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "copies the markup of the diagram as it is currently drawn" asserts the copied markup carries the turned viewBox and every turned box position, having first asserted the picture on screen really is the turned one |

Capability: `structured-exchange` — the one modified requirement.

`ReaderMayAdjustAndNarrowTheView` gains orientation to its list of adjustments; its
seven scenarios are unchanged except `AdjustmentDoesNotAlterTheDocument`, which now
says "repositions, turns or narrows".

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| EverythingIsShownUntilTheReaderNarrowsIt | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "shows everything until the reader hides something" (unchanged by this work) |
| NarrowingIsReversibleAndDeclared | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "hides a type when its key entry is clicked, and brings it back on a second click" and "says on screen that the picture is no longer the whole document" (unchanged) |
| ANarrowedProposalStillSaysWhatItProposes | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "keeps a hidden type in the key, marked hidden, so an exported figure says what is missing" and "never marks a hidden type the way it marks a removed one" (unchanged) |
| ElementAndRelationshipVocabulariesAreIndependent | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "hides a relationship type without hiding an element type of the same name" (unchanged) |
| AdjustmentDoesNotAlterTheDocument | covered | `ui/src/presentations/structuredExchangeOrientation.test.tsx` — "leaves the document itself untouched" covers the newly named adjustment; `ui/src/presentations/StructuredExchangeView.test.tsx` — "is recoverable as validated, after being validated and rendered" and "keeps a reader's column sizing out of the document" cover the other two |
| ATableNarrowsByRole | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "hides the rows of a role the reader switches off, and says it is doing so" (unchanged) |
| AHiddenRoleIsNotARemovedRow | covered | `ui/src/presentations/StructuredExchangeView.test.tsx` — "presents each declared role differently, and strikes a removed row through" with "hides the rows of a role the reader switches off" (unchanged) |
