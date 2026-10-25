## ADDED Requirements

### Requirement: ThePageStaysInView

Scrolling or zooming the editor SHALL never leave the page out of view. A page smaller than the visible area SHALL stay wholly inside it; a larger page SHALL never uncover more than a small margin beyond its edges.

#### Scenario: AFittedPageCannotBeScrolledAway
- **GIVEN** the page fitted to the view
- **WHEN** the person scrolls far in each of the four directions
- **THEN** the whole page stays inside the visible area

#### Scenario: AZoomedPageKeepsTheViewFilled
- **GIVEN** the page zoomed in beyond the view
- **WHEN** the person scrolls far in each of the four directions
- **THEN** no edge of the page comes more than the margin inside the visible area, so no empty desk fills the view
