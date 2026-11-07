# Security policy

## Reporting a vulnerability

Use GitHub's private reporting form:

**[Report a vulnerability](https://github.com/laurentftech/pi-outpost/security/advisories/new)**

Private vulnerability reporting is enabled for this repository. You need a GitHub account to
submit a report. Please keep exploit details out of public issues, discussions and pull requests
while the report is being assessed.

Include the affected version/commit, OS, Node.js version, deployment method, agent runtime and
sandbox runner; the effective security configuration; minimal reproduction steps; and the
expected and observed boundary. Redacted `pi-outpost doctor` output can help. Describe the impact
and the access an attacker needs. Use test data and remove credentials and private documents.

If the private form is unavailable, open a public issue asking for a private contact channel,
without describing the vulnerability or attaching sensitive data. Do not send secrets in an issue.

Maintainers assess reports and coordinate fixes and disclosure through the private advisory.
Response and remediation times depend on availability and impact; no fixed deadline is promised.
Please agree on disclosure timing through that channel rather than publishing an unreviewed exploit.

When a confirmed vulnerability in pi-outpost is fixed, the advisory is published with its GHSA
identifier and a CVE requested through GitHub, and the release that ships the fix names it in a
**Security** section of its release notes ([CHANGELOG.md](CHANGELOG.md), which is also the GitHub
Release's notes), with those identifiers, the affected versions and the fixed version.

## Supported versions

Security fixes target the **latest stable release**. Older releases have no guaranteed backports;
prereleases are evaluated individually. Include older-version findings even if you cannot yet
reproduce them on the latest release, and say which versions you tested. Operators should keep
pi-outpost, Node.js and their sandbox/container runtime current.

## Relevant security boundaries

Reports may concern authentication or authorization bypasses, cross-project data exposure,
credential disclosure, file/path confinement escapes, a mismatch between claimed and effective
sandbox permissions, unintended code execution, or unsafe rendering of untrusted content.

pi-outpost runs a coding agent capable of executing code with the permissions it is given.
Extensions and MCP servers are executable trusted resources and retain their process's rights.
Their normal, explicitly enabled execution is different from bypassing the controls that authorize
it. A shared server is not a hostile multi-tenant isolation boundary.

File-tool confinement, the agent's shell and the integrated terminal have distinct controls.
Report a suspected escape against the effective configuration and runner, including any grant or
explicitly disabled sandbox. Network restrictions depend on that configuration and platform;
filesystem confinement alone does not imply that all network access is denied. The full-app
Docker recipe has its own documented network default and required security profiles.

The authoritative setup and limitations are in [sandboxing](docs/sandboxing.md),
[configuration](docs/configuration.md), [deployment](docs/deployment.md) and
[Docker with Python](docs/docker.md). Run the server as an ordinary OS user, keep credentials
outside the project, and protect remote access with the documented authentication and transport.

## Verification and maintenance

[The quality guide](docs/quality.md) lists the repository's tests, static analysis, coverage scope
and current gaps. Passing CI is evidence about those checks, not a security certification.
Dependency alerts need triage for affected versions, reachable behaviour and available fixes;
avoid blanket suppression or forced unrelated downgrades as a substitute for assessment.
