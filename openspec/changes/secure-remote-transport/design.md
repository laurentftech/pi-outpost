# Design

## Context

OpenLore orient ran before inspection; its graph index was unavailable, so targeted reads identified config.ts/loadConfig, index.ts/Fastify and openBrowser.ts/browsableUrl. Existing clients derive WSS from HTTPS. The auth spec's unrestricted NoTokenConfigured scenario and architecture's claim that remote tokenless access is an operator choice disagree with requireTokenOffLoopback; this change retains the stricter implementation and explicitly narrows the auth scenario.

## Goals / Non-Goals

Require HTTPS for new direct remote listeners, preserve loopback HTTP and encrypted SSH tunnels, and make exceptional cleartext hops explicit. No self-signed production certificate generation, ACME automation, silent certificate-verification bypass, automatic reverse-proxy detection, TLS termination for the separate Open WebUI service, or outbound provider policy changes.

## Decisions

- `server.tls.certFile`/`keyFile` name PEM files; relative paths resolve against the loaded config. `PI_OUTPOST_TLS_CERT`/`PI_OUTPOST_TLS_KEY` override individual file paths and resolve against launch cwd. Both are required together.
- Use Node TLS and Fastify HTTPS with a TLS 1.2 minimum; load and validate material before opening the listener. Malformed, missing, mismatched or expired certificates refuse startup without disclosing key contents or reverting to HTTP. Certificates must be renewed and the process restarted.
- Non-loopback means the existing conservative literal loopback allowlist; hostname resolution is not treated as a security promise. Non-loopback still requires a token. `server.allowInsecureHttp` (default false), overridden by `PI_OUTPOST_ALLOW_INSECURE_HTTP=0|1`, is the sole cleartext opt-in. Forwarded headers never authorize a transport change.
- A remote plaintext opt-in emits a warning that encryption must be provided by the operator. It is a deliberate exception, not a claim that a proxy exists. Document loopback proxy/SSH as the preferred alternative; container recipes explicitly name their local protected-hop exception and keep host-loopback port publication.
- TLS covers the actual Fastify listener and every HTTP route plus its WebSocket upgrade. Never open a second HTTP listener or redirect after receiving credentials in cleartext. Existing authentication/Origin behavior remains.
- Local print mode is an ephemeral loopback-only client/server pair; it explicitly disables configured listener TLS for that pair. Browser-launch addresses select https when native TLS is active.

## Risks / Trade-offs

- Existing remote HTTP deployments stop until TLS or an explicit protected-hop exception is configured. Provide migration examples and test both refusal and compatibility paths.
- Native TLS proves encryption; browser trust and hostname matching still depend on an operator-issued certificate trusted by clients. No bypass is recommended. Tests use an isolated certificate and explicitly scoped test trust.
- Proxy/Tailscale/SSH protection cannot be inferred from request headers or bind address. The plaintext exception is documented and observable.
- Certificate files must remain outside the agent's readable workspace and be readable only by the service account; no key bytes enter config output, errors or protocol data.

## Migration Plan

Keep loopback deployments unchanged. For direct remote service configure trusted certificate/key and the public HTTPS origin. For SSH, keep the remote server on loopback and forward a local port. For a proxy/container protected hop explicitly allow HTTP only where network policy prevents direct exposure. Preserve existing token enforcement throughout.
