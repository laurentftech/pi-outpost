## ADDED Requirements

### Requirement: AWidePictureGoesBelowTheBullets

When a slide holds bullets and a picture side by side, and the picture would be drawn clearly larger
below the bullets across the width of both, the bullets SHALL be placed at the top of that width and
the picture below them. A picture the layout gives a picture placeholder SHALL stay in it.

#### Scenario: AWidePictureGoesBelowTheBullets
- **WHEN** a slide holds three bullets and a picture six times wider than high, in a two-content layout
- **THEN** the picture starts below the bullets, both span more than one column, and the picture is wider than a column

#### Scenario: ATallPictureStaysBesideTheBullets
- **WHEN** a slide holds bullets and a picture taller than wide
- **THEN** the bullets keep the layout's own column and the picture is in the other one
