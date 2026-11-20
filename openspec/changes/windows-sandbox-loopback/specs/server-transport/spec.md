# Spec Delta

## MODIFIED Requirements

### Requirement: SecureRemoteListener

The main server SHALL retain loopback HTTP, with the token `auth` requires. Off-loopback listeners SHALL require TLS and an operator-configured token unless the operator explicitly permits a protected plaintext hop via `server.allowInsecureHttp` or `PI_OUTPOST_ALLOW_INSECURE_HTTP=1`; the token remains mandatory and a generated one does not count. The environment SHALL override the file and accept only 0 or 1. Forwarded headers SHALL NOT authorize plaintext. An explicit remote plaintext listener SHALL emit a warning.

#### Scenario: LocalHttp
- **WHEN** a loopback listener starts without TLS configuration
- **THEN** HTTP and WS operate over plain HTTP, and the WebSocket still requires the token whether or not the client sends an Origin

#### Scenario: RemoteHttpRefused
- **WHEN** a non-loopback listener has a token but neither TLS nor an explicit cleartext exception
- **THEN** startup exits unsuccessfully before listening and explains how to configure encryption or the protected-hop exception

#### Scenario: ProtectedHopOptIn
- **WHEN** a non-loopback listener has a token and explicitly enables the cleartext exception
- **THEN** it serves HTTP/WS and emits a warning, without trusting forwarded headers as encryption evidence

#### Scenario: RemoteStillRequiresToken
- **WHEN** a non-loopback listener has TLS or the cleartext exception but no configured token
- **THEN** startup is refused, even when a generated token exists in the agent directory

#### Scenario: EnvironmentPolicyOverride
- **WHEN** file transport settings are overridden by TLS file environment variables or the cleartext-policy environment variable
- **THEN** environment values win, paths resolve against launch cwd, and invalid policy values are refused
