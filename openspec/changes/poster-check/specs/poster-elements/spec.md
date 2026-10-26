## ADDED Requirements

### Requirement: LookingAtANonPosterSaysSo

`poster_pictures` SHALL answer a `.poster.html` that is not a poster with that refusal, as an
error, rather than saying it holds no picture.

#### Scenario: PosterPicturesNamesANonPoster
- **GIVEN** a `.poster.html` without the poster markers
- **WHEN** the agent asks `poster_pictures` for its pictures
- **THEN** the answer is an error saying it is not a poster and naming the missing marker, and does not say its frames are empty
