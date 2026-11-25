# Spec Delta

## ADDED Requirements

### Requirement: APosterReferencedInAReplyIsShownInPlace

When a reply references a workspace `.poster.html` file as a picture (`![rules](./posters/rules.poster.html)`),
the conversation SHALL show the poster in place of the image: read-only, in a sandboxed frame, scaled to the
reply, as a block of its own (never inside a paragraph). The frame SHALL run no script and hold an opaque
origin, so the poster page cannot reach the host page. A file that cannot be read or parsed SHALL offer to
open it in the file viewer, naming the file, rather than leave a broken picture. Other pictures, and poster
URLs on other sites, SHALL stay plain images. A link to a `.poster.html` file SHALL keep opening the file
viewer's poster editor, unchanged.

#### Scenario: APosterReferencedAsAPictureIsShownInTheReply
- **WHEN** a reply contains `![rules](./posters/Class%20rules.poster.html)` and the file exists
- **THEN** the poster is shown in the reply, read-only, in a sandboxed frame sized to its paper format and scaled to fit, as a block outside any paragraph; no `<img>` is rendered for it

#### Scenario: AnUnreadablePosterOffersTheViewer
- **WHEN** a reply references a `.poster.html` file that cannot be fetched or parsed
- **THEN** the reply offers to open the file in the file viewer, naming its path, and leaves no broken picture or empty frame

#### Scenario: OtherPicturesStayPictures
- **WHEN** a reply contains an ordinary image, or a poster URL on another site
- **THEN** both render as plain images, as before
