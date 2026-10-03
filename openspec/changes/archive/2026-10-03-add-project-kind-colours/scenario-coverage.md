# Scenario coverage — add-project-kind-colours

Capabilities: `structured-exchange-appearance` (new, 4 requirements) and `structured-exchange-profiles`
(`AProjectDeclaresItsProfilesLocally` modified: registry version 2, profiles optional).

Test files cited below:

- `server/test/structuredExchangeAppearanceRegistry.test.ts` — the registry format and reader.
- `server/test/structuredExchangeAppearanceFigure.test.ts` — the palette, graph and sequence figures, `write_structure_figure`.
- `server/test/structured-exchange-appearance-wire.test.mjs` — a real server and socket: snapshots, live documents, saves, a broken registry.
- `ui/src/presentations/structuredExchangeAppearance.test.tsx` — the reader: timeline, graph, reply, legend, envelope.
- `ui/src/useAgent.test.ts` — client state across snapshots and project switches.

Driven in the bench as well (`npm run bench`, version 2 registries on the seeded and plain servers):
timeline and graph in the conversation and the file viewer drawn in the declared colours with marked
legends; the element/relationship `power` split; a colour saved in the viewer applied without reload; a
broken colour falling back to automatic colours; compact view and enlarge keeping the colours.

## structured-exchange-appearance

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| AColourIsDeclaredForAKind | covered | `server/test/structuredExchangeAppearanceRegistry.test.ts` — "AColourIsDeclaredForAKind": `readProjectAppearance` returns the declared colour. |
| AMalformedColourMakesTheRegistryUnusable | covered | Same file — "AMalformedColourMakesTheRegistryUnusable": registry `unusable`, exactly one issue `registry/appearance/color` naming the registry file at `/appearance/kinds/SRR/color`; no appearance. Also "an unknown property beside a colour is refused at that property" and "a map past its ceiling is refused". |
| VocabulariesAreSeparate | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "VocabulariesAreSeparate": `sensor` declared as a relationship kind leaves the element `sensor` uncoloured, `power` as a relationship kind colours the relationship. Registry half: "VocabulariesAreSeparate (as declared)". |
| AVersionOneRegistryIsUnchanged | covered | `server/test/structuredExchangeAppearanceRegistry.test.ts` — "AVersionOneRegistryIsUnchanged": v1 still requires profiles, refuses `appearance`, reads usable with no appearance. Every existing profile/registry/rules suite passes unchanged. |
| ATimelineMilestoneTakesItsProjectColour | covered | `ui/src/presentations/structuredExchangeAppearance.test.tsx` — "ATimelineMilestoneTakesItsProjectColour": SRR star `#dc2626`, legend entry marked project colour, PDR automatic and not red; "a timeline in a reply takes the project colour too". |
| AGraphElementTakesItsProjectColour | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "AGraphElementTakesItsProjectColour"; `ui/src/presentations/structuredExchangeAppearance.test.tsx` — "a graph element in a tool card takes its project colour". |
| AnUnnamedKindKeepsAnAutomaticColourDistinctFromDeclaredOnes | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "AnUnnamedKindKeepsAnAutomaticColourDistinctFromDeclaredOnes": the colour a kind would get automatically is declared for another; the first gets a different colour. |
| TheFigureWriterUsesProjectColours | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "TheFigureWriterUsesProjectColours": `write_structure_figure` in a project with a v2 registry writes an SVG with both declared colours and a marked key entry. |
| NoAppearanceChangesNothing | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "NoAppearanceChangesNothing (palette)" and "(figures are byte-identical)" with no, empty, and unrelated appearance; `ui/src/presentations/structuredExchangeAppearance.test.tsx` — "NoAppearanceChangesNothing (in the reader)". |
| TheDocumentIsUntouched | covered | `ui/src/presentations/structuredExchangeAppearance.test.tsx` — "TheDocumentIsUntouched" (envelope shown equals the presented document, no colour); `server/test/structured-exchange-appearance-wire.test.mjs` asserts the `tool_end` document is exactly the presented one. |
| ALegendMarksAProjectColour | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "ALegendMarksAProjectColour" (`data-colour-source="project"`, title, only the declared entry); timeline legend in "ATimelineMilestoneTakesItsProjectColour". |
| ASharedDeclaredColourIsSaid | covered | `server/test/structuredExchangeAppearanceFigure.test.ts` — "ASharedDeclaredColourIsSaid" and "two kinds sharing a declared colour keep it and are named"; `ui/src/presentations/structuredExchangeAppearance.test.tsx` — "ASharedDeclaredColourIsSaid (timeline legend)". |
| AnEditedRegistryRecoloursTheNextDocument | covered | `server/test/structured-exchange-appearance-wire.test.mjs` — the registry is rewritten on disk, a document is presented, and the appearance that follows carries the new colour; no restart. |
| ARegistrySavedInTheViewerRecoloursAtOnce | covered | Same wire test: a `write_file` of the registry is followed by the new appearance, with nothing else to trigger it. Bench: saved in the viewer, the timeline recoloured without reload. |
| AnUnusableRegistrySendsNoAppearance | covered | Same wire test: after a malformed colour, a new reader receives `appearance: null`. `ui/src/useAgent.test.ts` — "holds the project's kind colours across its own snapshots, and drops them for another project". |

## structured-exchange-profiles

| Scenario | Coverage | Evidence |
| --- | --- | --- |
| ARegisteredProfileIsFoundByItsIdentifier | covered | `server/test/structuredExchangeProjectProfiles.test.ts` — "a registered profile is found by its identifier…". Unchanged by this change. |
| ARegistryPathLeavingTheProjectIsRefused | covered | `server/test/structuredExchangeProjectProfiles.test.ts` — "a profile path climbing out of the project is refused…". Unchanged. |
| ProfilesAreNeverRetrieved | covered | `server/test/structuredExchangeProfileCheck.test.ts` — "is matched as a string and never retrieved". Unchanged. |
| AnEditedProfileAppliesToTheNextCheck | covered | `server/test/structuredExchangeToolProfiles.test.ts` — "an edited profile applies to the very next call…". Unchanged. |
| AProjectWithoutARegistryIsUnconstrained | covered | `server/test/structuredExchangeProjectProfiles.test.ts` — "a project without a registry is unconstrained". Unchanged. |
| RegisteredRulesApplyToTheirProfile | covered | `server/test/structuredExchangeProjectRules.test.ts` — "registered rules are available for the profile they name…". Unchanged. |
| AnEditedRulesFileAppliesToTheNextCheck | covered | `server/test/structuredExchangeToolRules.test.ts` — "an edited rules file applies to the next call…". Unchanged. |
| ARegistryWithOnlyAnAppearanceConstrainsNothing | covered | `server/test/structuredExchangeAppearanceRegistry.test.ts` — "ARegistryWithOnlyAnAppearanceConstrainsNothing" (usable, no profile, no default) and "(presenting)": a graph with any kind and free attributes is presented, with no profile statement. |
| ADefaultNeedsARegisteredProfile | covered | Same file — "ADefaultNeedsARegisteredProfile": unusable, `registry/unregistered-default` at `/default`, message "registered: none". |
