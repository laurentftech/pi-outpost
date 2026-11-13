# Server Transport Specification

## Purpose

Protect credentials and application traffic when the main pi-outpost server is deployed beyond its local host, with explicit transport exceptions for operator-protected hops.

## Requirements

### Requirement: SecureRemoteListener

The main server SHALL retain loopback HTTP. Off-loopback listeners SHALL require TLS and a token unless the operator explicitly permits a protected plaintext hop via `server.allowInsecureHttp` or `PI_OUTPOST_ALLOW_INSECURE_HTTP=1`; the token remains mandatory. The environment SHALL override the file and accept only 0 or 1. Forwarded headers SHALL NOT authorize plaintext. An explicit remote plaintext listener SHALL emit a warning.

#### Scenario: LocalHttp
- **WHEN** a loopback listener starts without TLS configuration
- **THEN** HTTP and WS operate with existing authentication and Origin behavior

#### Scenario: RemoteHttpRefused
- **WHEN** a non-loopback listener has a token but neither TLS nor an explicit cleartext exception
- **THEN** startup exits unsuccessfully before listening and explains how to configure encryption or the protected-hop exception

#### Scenario: ProtectedHopOptIn
- **WHEN** a non-loopback listener has a token and explicitly enables the cleartext exception
- **THEN** it serves HTTP/WS and emits a warning, without trusting forwarded headers as encryption evidence

#### Scenario: RemoteStillRequiresToken
- **WHEN** a non-loopback listener has TLS or the cleartext exception but no token
- **THEN** startup is refused

#### Scenario: EnvironmentPolicyOverride
- **WHEN** file transport settings are overridden by TLS file environment variables or the cleartext-policy environment variable
- **THEN** environment values win, paths resolve against launch cwd, and invalid policy values are refused
### Requirement: NativeTls

The server SHALL load paired PEM paths from `server.tls.certFile` and `keyFile`, overridden by `PI_OUTPOST_TLS_CERT`/`PI_OUTPOST_TLS_KEY`. Native TLS SHALL serve HTTPS/WSS using TLS 1.2 or newer, preserving auth/Origin checks. Unreadable, invalid, mismatched or expired material SHALL refuse startup, even with plaintext opted in. Errors/config output SHALL NOT expose key bytes. There SHALL be no HTTP fallback. Announced/browser URLs SHALL use HTTPS.

#### Scenario: TlsFilesResolveAgainstConfig
- **WHEN** a config file names relative TLS file paths
- **THEN** both paths resolve against that file's directory, independently of process cwd

#### Scenario: IncompleteTlsRejected
- **WHEN** TLS file paths are missing, empty or of the wrong type
- **THEN** configuration is refused with the field named

#### Scenario: HttpsAndWss
- **WHEN** a remote listener starts with valid TLS and a token
- **THEN** clients trusting the certificate can use HTTPS routes and WSS, unauthorized requests remain refused, and TLS older than 1.2 is refused

#### Scenario: InvalidTlsFailsClosed
- **WHEN** configured TLS files are unreadable, invalid, mismatched or expired, even with the cleartext exception enabled
- **THEN** startup fails without an HTTP fallback or private key disclosure

#### Scenario: NoPlaintextFallback
- **WHEN** a plaintext HTTP request reaches a native TLS listener
- **THEN** no application response or agent data is returned

#### Scenario: HttpsBrowserAndReconnect
- **WHEN** the built app is opened through HTTPS and the connection is interrupted and restored
- **THEN** its authenticated WSS connection recovers, the DOM reports the real connected state, and startup/browser URLs use HTTPS

#### Scenario: LocalPrintWithTlsConfiguration
- **WHEN** local print mode uses a configuration containing TLS listener files
- **THEN** its ephemeral loopback-only connection remains functional without weakening the configured remote service
