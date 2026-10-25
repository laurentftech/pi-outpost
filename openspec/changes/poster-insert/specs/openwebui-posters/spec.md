## ADDED Requirements

### Requirement: APosterIsRetitled

`update_poster` SHALL accept an optional new title, which becomes the poster's title in `list_posters`, `get_poster` and the names of its downloads.

#### Scenario: TheNewTitleIsListed
- **WHEN** the model updates a poster with the title "Menu du jour"
- **THEN** `list_posters` and `get_poster` give "Menu du jour" for that poster id

### Requirement: TheModelCanLookAtThePicturesInOpenWebUI

`get_poster` SHALL accept a request to see the pictures. Given it, the answer SHALL also list each photo or drawing the user put in, up to eight, with its marker and the picture as a whole base64 data URL, the form Open WebUI hands a model as an image in native function calling. Without the request, no picture SHALL be sent.

#### Scenario: TheModelSeesWhatAFrameHoldsInOpenWebUI
- **GIVEN** a poster whose frame holds a photo the user put in
- **WHEN** the model reads it asking to see the pictures
- **THEN** the answer lists that photo with its marker, as a whole base64 data URL, and the markup still holds markers only

#### Scenario: PicturesAreNotSentUnaskedInOpenWebUI
- **WHEN** the model reads the poster without asking to see the pictures
- **THEN** the answer holds no picture
