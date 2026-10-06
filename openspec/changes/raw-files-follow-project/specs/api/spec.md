## MODIFIED Requirements

### Requirement: GETFilesRaw

The server SHALL expose `GET /files/raw?path=<relative>[&workspace=<id>]` returning the raw bytes of a file inside the browser root of the project named by `workspace` — the `id` (or, from a server without ids, the `root`) of a project the server has already open, exactly as the session snapshot reports it. A request naming a project that is not open SHALL be answered 404 and SHALL never open one. A request naming no project SHALL read from the project the server booted with. The client SHALL name the project its connection is bound to on every `/files/raw` request it builds (image viewer, PDF viewer, images in a viewed Markdown file and in replies, preview attachments, and the Word and conversation exports). The path SHALL be confined to the browser root using the same resolution as the WebSocket file browser (symlink-safe, no traversal). The size limit SHALL depend on the file's type: PDFs and files with an image extension of the allowlist below SHALL be rejected with 413 above the configured PDF limit (`pdf.maxBytes`, default 25 MiB), and every other file SHALL be rejected with 413 above 1 MiB. A 413 SHALL name the limit that was applied. Responses SHALL carry an image content type only for a known image-extension allowlist (png, jpg/jpeg, gif, webp, svg, avif); all other files — PDFs included — SHALL be served as `application/octet-stream` with `Content-Disposition: attachment` so no workspace file can execute or render in the server's origin. When `server.token` is set, the request SHALL be rejected with 401 unless a valid `token` query parameter (or Bearer header) is supplied, using the same timing-safe comparison as the WebSocket. When no token is configured, the request SHALL be rejected with 403 unless the `Host` header names localhost/127.0.0.1/[::1], the configured bind host, or a configured allowed origin — a DNS-rebinding page cannot present any of these.

#### Scenario: ServeImage
- **GIVEN** `plot.png` (200 KiB) inside the browser root and no auth token configured
- **WHEN** the client requests `GET /files/raw?path=plot.png`
- **THEN** the response is 200 with `Content-Type: image/png` and the file bytes

#### Scenario: ConfinementRefusal
- **WHEN** the client requests `GET /files/raw?path=../secret.txt` or an absolute path outside the root
- **THEN** the response is 404 and no file content is returned

#### Scenario: NonImageIsAttachment
- **GIVEN** `report.html` inside the browser root
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response has `Content-Type: application/octet-stream` and `Content-Disposition: attachment`

#### Scenario: PdfIsAttachment
- **GIVEN** `report.pdf` inside the browser root
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response has `Content-Type: application/octet-stream` and `Content-Disposition: attachment`, so the browser's own PDF viewer never runs it on this origin

#### Scenario: TokenRequired
- **GIVEN** a server with `server.token` configured
- **WHEN** the client requests `/files/raw?path=plot.png` without a token or with a wrong one
- **THEN** the response is 401

#### Scenario: DnsRebindingBlocked
- **GIVEN** a token-less server bound to 127.0.0.1
- **WHEN** a request arrives with `Host: evil.com` (a rebound attacker domain)
- **THEN** the response is 403 and no file content is returned

#### Scenario: OversizeRejected
- **GIVEN** a text file larger than 1 MiB inside the browser root
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response is 413, naming the 1 MiB limit

#### Scenario: ImageUnderThePdfLimit
- **GIVEN** a 2 MB PNG and a 2 MB JPEG inside the browser root and a 25 MiB PDF limit
- **WHEN** the client requests each via `/files/raw`
- **THEN** each response is 200 with its image content type and the file bytes

#### Scenario: ImageOverThePdfLimit
- **GIVEN** an image larger than the configured PDF limit
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response is 413, naming the PDF limit

#### Scenario: PdfUnderItsOwnLimit
- **GIVEN** a 6 MiB PDF inside the browser root and a 25 MiB PDF limit
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response is 200 with the file bytes

#### Scenario: PdfOverItsOwnLimit
- **GIVEN** a PDF larger than the configured PDF limit
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response is 413

#### Scenario: ServeFromTheNamedProject
- **GIVEN** a server that booted on project A and holds project B open, each with a different `shared.png`, and `figures/only-beta.png` only in B
- **WHEN** the client requests `/files/raw?path=figures/only-beta.png&workspace=<B's id>` and `/files/raw?path=shared.png` naming A, then B
- **THEN** each response is 200 with the bytes of the named project's file

#### Scenario: UnnamedReadsTheBootProject
- **GIVEN** the same two projects
- **WHEN** the client requests `/files/raw?path=shared.png` and `/files/raw?path=figures/only-beta.png` without naming a project
- **THEN** the first answers with A's bytes and the second is 404

#### Scenario: UnopenedProjectRefused
- **GIVEN** a directory holding `shared.png` that is not an open project
- **WHEN** the client names that directory, a subdirectory of an open project, or an unknown id as `workspace`
- **THEN** the response is 404 with no file content, and confinement still applies inside a named project

#### Scenario: ClientNamesTheBoundProject
- **GIVEN** the interface bound to project B
- **WHEN** it shows an image file, or an image referenced by a viewed Markdown file or by a reply
- **THEN** the `/files/raw` URL it builds carries `workspace=<B's id>`, and the image decodes
