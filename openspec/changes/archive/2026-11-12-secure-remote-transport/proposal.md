# Proposal

## Why

A remote bind currently requires authentication but serves credentials, conversations and files over HTTP/WS. Remote deployment should require an encrypted transport by default, while local access and SSH/proxy deployments remain practical.

## What Changes

- Add native HTTPS/WSS using configured PEM certificate/key files and TLS 1.2 or newer.
- **BREAKING**: refuse non-loopback HTTP by default, even with a token. An explicit `server.allowInsecureHttp` exception supports a protected proxy/tunnel/container hop; announce it at startup.
- Preserve local HTTP and document SSH port forwarding to a loopback-bound server.
- Resolve TLS files relative to the configuration; support environment overrides. Invalid TLS never falls back to HTTP.
- Keep existing authentication, Origin checks and confinement; report/open HTTPS URLs accurately.

## Capabilities

### New Capabilities

- `server-transport`: encrypted listener configuration, remote-bind policy, startup failure and protected-hop exceptions.

### Modified Capabilities

- `auth`: scope the no-token case to local listeners, matching the existing implementation.

## Impact

Server configuration/startup and browser-launch URL; transport integration tests and running-app Playwright checks; deployment, SSH, Docker and configuration documentation. No new production dependencies, certificate issuer, automatic trust installation or changes to the separate Open WebUI tool server. Existing OpenSpec architecture prose incorrectly allows tokenless remote binds: the new transport contract and auth delta explicitly supersede that statement; authentication remains mandatory remotely.
