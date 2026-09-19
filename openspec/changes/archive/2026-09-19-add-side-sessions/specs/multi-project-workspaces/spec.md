## ADDED Requirements

### Requirement: NameTheProjectInTheBrowserTab

The standalone app SHALL name the project it is showing in the browser tab title, followed by the title it shows today — an extension's title when one is set, else the branded title. When the session shown is a side session, the title SHALL also carry the side session's label. A server holding a single unnamed workspace SHALL keep today's title. An embedded widget SHALL NOT change the host page's title.

#### Scenario: TheTabNamesTheProject
- **GIVEN** the standalone app showing project `pi-outpost`, branded `pi`
- **WHEN** the page is displayed
- **THEN** the tab title is `pi-outpost — pi`

#### Scenario: TheTabFollowsTheProject
- **GIVEN** the standalone app showing project `alpha`
- **WHEN** the user switches to project `beta`
- **THEN** the tab title names `beta`

#### Scenario: TheTabNamesTheSideSession
- **GIVEN** the standalone app showing a side session named `fix typo` on project `pi-outpost`
- **WHEN** the page is displayed
- **THEN** the tab title is `pi-outpost · fix typo — pi`

#### Scenario: AnExtensionTitleKeepsTheProjectName
- **GIVEN** the standalone app showing project `pi-outpost`
- **WHEN** an extension sets the title to `Review`
- **THEN** the tab title is `pi-outpost — Review`

#### Scenario: TheWidgetLeavesTheHostTitleAlone
- **GIVEN** an embedded widget on a host page titled `Docs`
- **WHEN** the widget shows a project
- **THEN** the host page's title is still `Docs`
