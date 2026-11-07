# Governance

This page describes how pi-outpost is run today. It records the current state, not an aspiration;
it changes when the project's organisation changes.

## Roles

**Maintainer**: Laurent Francoise ([`laurentftech`](https://github.com/laurentftech)), the only
person with write access to the repository and publish rights on the npm packages. The maintainer:

- sets the project's direction and decides what is in scope;
- reviews and merges pull requests;
- cuts releases;
- handles vulnerability reports ([SECURITY.md](SECURITY.md));
- enforces the [code of conduct](CODE_OF_CONDUCT.md).

**Contributors**: anyone who opens an issue, a discussion or a pull request. Contributing grants
no access; see [CONTRIBUTING.md](CONTRIBUTING.md) for how to propose a change.

There are no other roles at present. When volunteers join, their role, access and
responsibilities will be added here before they receive any permission.

## Decisions

The maintainer decides. A substantial feature or architectural change starts as an issue that
describes the problem and the proposed scope, so it can be discussed before code is written.
Significant design choices are recorded with the change that makes them: in its OpenSpec
proposal and design under [`openspec/`](openspec/), and in the pull request.

## Accepting contributions

Every change to `main` goes through a pull request and must pass the required checks; no one,
the maintainer included, can bypass them ([merge enforcement](docs/quality.md#merge-enforcement)).
A pull request is accepted when it fits the project's scope, passes CI, and its tests and
documentation match the behaviour it changes. No second approval is required yet, because the
project has one maintainer.

## Releases

The maintainer prepares a release by following
[`docs/development.md` § Releasing](docs/development.md#releasing). The release workflow builds and
publishes the packages from GitHub Actions, using npm's OIDC trusted publishing with provenance,
so no long-lived publish token exists.

## Security

Vulnerability reports go through GitHub's private reporting form, as described in
[SECURITY.md](SECURITY.md). The maintainer's GitHub account uses two-factor authentication with a
passkey. Anyone given write access in the future must use two-factor authentication too, with a
passkey or hardware key.

## Continuity

The project currently has a single maintainer, and no one else can take over issues, merges and
releases. This is a known risk. The plan is to name a trusted person with minimal permissions and a
written, tested hand-over procedure once volunteers are available. Progress is tracked in
[OpenSSF Best Practices: status and plan](docs/openssf.md).

## Changing this document

Changes to governance are made by pull request, like any other change, and take effect when
merged.
