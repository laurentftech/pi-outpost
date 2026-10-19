## MODIFIED Requirements

### Requirement: ShowingDrawsTheTimelineInTheHost

Showing a planning SHALL declare an MCP Apps view, served as a `ui://` resource of type
`text/html;profile=mcp-app` and needing no network, that draws the planning with pi-outpost's timeline:
its scales, its details, its dependencies and, when asked, a comparison with an earlier revision. The
tool's answer SHALL give the view the planning as structured content and the model a text summary. The
structured content SHALL also carry that summary, for hosts that give the model the structured content
in place of the text. The view SHALL report its size to the host and SHALL remain readable in a host
using a dark theme.

#### Scenario: TheViewDrawsTheShownPlanning
- **WHEN** a planning is shown in an MCP Apps host
- **THEN** the view draws every task and item of its current revision, and the model receives a
  summary naming the planning, its revision and its period

#### Scenario: AComparisonIsDrawn
- **WHEN** a planning is shown compared with revision 1 after a milestone moved
- **THEN** the view draws the milestone's previous and current positions

#### Scenario: TheViewNeedsNoNetwork
- **WHEN** the view's resource is read
- **THEN** it declares no external domain, and its page references no external resource

#### Scenario: TheSummaryReachesAHostThatReadsStructuredContent
- **WHEN** a planning is shown, and the host gives the model the structured content instead of the text
- **THEN** the structured content carries the same summary as the text, including the note that an
  invalid file was replaced by its last valid revision
