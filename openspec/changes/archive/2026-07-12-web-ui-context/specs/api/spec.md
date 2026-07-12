# Delta: api

## ADDED Requirements

### Requirement: GETFilesRaw

The server SHALL expose `GET /files/raw?path=<relative>` returning the raw bytes of a file inside the browser root. The path SHALL be confined to the browser root using the same resolution as the WebSocket file browser (symlink-safe, no traversal). Files over 1 MiB SHALL be rejected with 413. Responses SHALL carry an image content type only for a known image-extension allowlist (png, jpg/jpeg, gif, webp, svg, avif); all other files SHALL be served as `application/octet-stream` with `Content-Disposition: attachment` so no workspace file can execute in the server's origin. When `server.token` is set, the request SHALL be rejected with 401 unless a valid `token` query parameter (or Bearer header) is supplied, using the same timing-safe comparison as the WebSocket. When no token is configured, the request SHALL be rejected with 403 unless the `Host` header names localhost/127.0.0.1/[::1], the configured bind host, or a configured allowed origin — a DNS-rebinding page cannot present any of these.

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

#### Scenario: TokenRequired
- **GIVEN** a server with `server.token` configured
- **WHEN** the client requests `/files/raw?path=plot.png` without a token or with a wrong one
- **THEN** the response is 401

#### Scenario: DnsRebindingBlocked
- **GIVEN** a token-less server bound to 127.0.0.1
- **WHEN** a request arrives with `Host: evil.com` (a rebound attacker domain)
- **THEN** the response is 403 and no file content is returned

#### Scenario: OversizeRejected
- **GIVEN** a 2 MiB image inside the browser root
- **WHEN** the client requests it via `/files/raw`
- **THEN** the response is 413
