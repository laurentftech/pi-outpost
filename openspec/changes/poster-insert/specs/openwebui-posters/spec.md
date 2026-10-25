## ADDED Requirements

### Requirement: APosterIsRetitled

`update_poster` SHALL accept an optional new title, which becomes the poster's title in `list_posters`, `get_poster` and the names of its downloads.

#### Scenario: TheNewTitleIsListed
- **WHEN** the model updates a poster with the title "Menu du jour"
- **THEN** `list_posters` and `get_poster` give "Menu du jour" for that poster id
