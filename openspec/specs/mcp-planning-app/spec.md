# mcp-planning-app Specification

## Purpose
A local MCP App that keeps a person's plannings in a folder they pick, edits them through validated
targeted operations, shows them as pi-outpost's interactive timeline in any MCP Apps host, and lets the
model know what the person selected — with the same contract and verdicts as pi-outpost.

## Requirements
### Requirement: PlanningsLiveInTheChosenFolder

The server SHALL keep plannings in the folder the user configured, creating it if it does not exist,
and SHALL refuse to start, naming the setting, when no folder is configured. Each planning SHALL be one
file in that folder holding its current version as a complete structured-exchange document, readable
as it is by pi-outpost. Every revision SHALL be kept, unchanged, in a history kept beside the plannings
and hidden from a casual listing of the folder. Nothing SHALL be written outside the configured folder.
The folder SHALL remain the person's: a planning file renamed there SHALL keep its history, and a
valid timeline file placed there SHALL be listed as a planning.

#### Scenario: TheFolderIsCreatedWhenMissing
- **WHEN** the server starts with a configured folder that does not exist
- **THEN** the folder is created, and a planning created next is written in it

#### Scenario: NoFolderNoStart
- **WHEN** the server starts with no folder configured
- **THEN** it exits with an error naming the missing setting

#### Scenario: APlanningIsOneReadableFile
- **WHEN** a planning titled "Travaux maison" is created
- **THEN** the folder holds one file named after the title whose content is the planning's current
  document, valid under pi-outpost's structured-exchange check

#### Scenario: HistoryIsKeptBesideAndHidden
- **WHEN** a planning is updated twice
- **THEN** its file holds the third revision, the first two are readable unchanged from the hidden
  history, and listing the folder's visible files shows only the planning file

#### Scenario: ARenamedFileKeepsItsHistory
- **WHEN** a planning's file is renamed in the folder, unchanged, and plannings are listed
- **THEN** the planning is listed under the same id with the same revision, and the next update is
  written to the renamed file

#### Scenario: ATimelineFileInTheFolderIsAPlanning
- **WHEN** a valid timeline file the server did not create is placed in the folder, and plannings
  are listed
- **THEN** it is listed as a planning at revision 1, its file is left as it was, and it can be read,
  shown and updated

#### Scenario: NothingIsWrittenOutsideTheFolder
- **WHEN** plannings are created, updated and shown, including one whose title contains `../` and `/`
- **THEN** every file written is inside the configured folder

### Requirement: ThePlanningToolsKeepTheirContract

The server SHALL offer list, create, get, update and show for plannings, with the same validation,
targeted operations, revision checks and diagnostics as the Open WebUI server's planning tools, from
the same shared code. A refusal SHALL change nothing and SHALL be worded for the model. Every answer
SHALL carry text the model can read.

#### Scenario: CreateThenListThenGet
- **WHEN** a valid timeline is created, then plannings are listed and the new one is read
- **THEN** it is listed with its title and revision 1, and reading it returns the document as created

#### Scenario: AnInvalidTimelineIsRefusedWithTheGatesDiagnostics
- **WHEN** a timeline with an inverted activity is created
- **THEN** nothing is written, and the diagnostics equal pi-outpost's gate's for that document

#### Scenario: AnUpdateIsTargetedAndRevisioned
- **WHEN** an update moves one milestone against the current revision
- **THEN** the planning file differs from the previous revision in that date only, and an update
  against the previous revision is then refused, naming the current one

#### Scenario: AFileEditedByHandIsJudgedOnRead
- **WHEN** a planning file is edited outside the server into an invalid document, and the planning is
  read
- **THEN** the answer carries the gate's diagnostics, and the listing marks that planning as unreadable
  rather than hiding it

### Requirement: ShowingDrawsTheTimelineInTheHost

Showing a planning SHALL declare an MCP Apps view, served as a `ui://` resource of type
`text/html;profile=mcp-app` and needing no network, that draws the planning with pi-outpost's timeline:
its scales, its details, its dependencies and, when asked, a comparison with an earlier revision. The
tool's answer SHALL give the view the planning as structured content and the model a text summary. The
view SHALL report its size to the host and SHALL remain readable in a host using a dark theme.

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

### Requirement: TheFolderIsShownInTheHost

Listing plannings SHALL also declare the view, which SHALL show every planning of the folder — its
title, revision, last change and file name, and whether its file is unreadable — under the folder's
name. Choosing a planning in the list SHALL draw its timeline in the same view, with a way back to the
list, and SHALL NOT send a message to the conversation.

#### Scenario: TheListShowsTheFolder
- **WHEN** the plannings are listed in an MCP Apps host
- **THEN** the view shows each planning of the folder with its title, revision and file name, and marks
  an unreadable one

#### Scenario: ChoosingAPlanningDrawsIt
- **WHEN** the person chooses a planning in the listed view, then goes back
- **THEN** its timeline is drawn in place through the server's show tool, the list returns, and no
  message is sent to the conversation

### Requirement: TheSelectionReachesTheModel

When the person selects a task or an item in the view, the view SHALL record the selection through a
tool only views can call, and SHALL also offer it to the host's model context. Reading the planning
SHALL return the current selection, naming the task or item and its identifier, and the model SHALL be
able to ask for the current selection without knowing which planning it is in. Unselecting SHALL clear
it. The view SHALL NOT send a message to the conversation on the person's behalf.

#### Scenario: AClickedMilestoneIsReturnedByGetPlanning
- **WHEN** the person clicks a milestone in the view, then the model reads the planning
- **THEN** the answer names that milestone, its identifier and its task as the current selection

#### Scenario: ItIsFoundWithoutNamingThePlanning
- **WHEN** the person clicks a milestone in one of several plannings, then the model is asked to move
  "it" without the planning being named
- **THEN** a tool the model can call with no argument names that planning, the milestone, its
  identifier and its task; with nothing selected, it says so

#### Scenario: TheSelectionToolIsNotTheModels
- **WHEN** the server's tools are listed
- **THEN** the selection tool is marked callable by the view only

#### Scenario: ClickingSendsNoMessage
- **WHEN** the person clicks tasks and milestones in the view
- **THEN** the view asks the host to update its model context and calls the selection tool, and never
  asks the host to send a message

### Requirement: InstalledByDoubleClick

The package SHALL build into a `.mcpb` bundle that passes the MCP Bundle validator, starts its server
with the host's own Node.js, and asks the user, at installation, for the plannings folder through a
directory picker with no default value. Each release SHALL attach the bundle.

#### Scenario: TheBundleValidates
- **WHEN** the bundle is built
- **THEN** its manifest passes `mcpb validate`, it declares a required directory setting with no
  default, and it holds the server and the view

#### Scenario: TheBundledServerAnswersOverStdio
- **WHEN** the bundled server is started over stdio with a folder, and a client initializes, lists the
  tools, reads the view's resource, creates a planning and shows it
- **THEN** each step succeeds, and the planning file is in the folder

### Requirement: OneCoreForEveryServer

The timeline gate, the targeted update operations, the structured-exchange guide and the planning
tools' descriptions and examples SHALL exist once, in a package both the Open WebUI server and the MCP
server import. Neither server SHALL hold its own copy.

#### Scenario: BothServersDescribeTheToolsAlike
- **WHEN** the descriptions of create, update and show planning are read from both servers
- **THEN** they are the same text, taken from the shared package
