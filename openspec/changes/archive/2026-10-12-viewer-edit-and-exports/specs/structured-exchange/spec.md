## ADDED Requirements

### Requirement: ARearrangedFigureFitsWhatIsDrawn

Once the reader has moved a box in a graph, the figure's canvas SHALL fit what is drawn — boxes,
containers and relationships, with the key below them — in every direction, so that boxes pulled
together shrink the canvas and the SVG exported from it. A figure nobody has rearranged SHALL keep the
canvas of its layout.

#### Scenario: BoxesPulledTogetherShrinkTheFigure
- **GIVEN** a graph laid out across the page
- **WHEN** the reader moves its boxes closer together
- **THEN** the canvas is smaller than the laid-out one, every box and container is inside it, and the SVG downloaded is that canvas

#### Scenario: AnUntouchedFigureKeepsItsLayout
- **WHEN** no box has been moved
- **THEN** the canvas is the layout's, unchanged
