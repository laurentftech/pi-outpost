# Product roadmap

Published: 8 November 2026. Planning horizon: November 2026 through the end of 2027.

Pi Outpost is an individual project, maintained by Laurent Francoise. This roadmap describes
the project's current direction for at least the next twelve months. It is not a delivery
schedule: there are no committed milestones, release dates or completion guarantees. Work depends
on the maintainer's available time, demonstrated user needs and the cost of maintaining it.

## Project direction

Pi Outpost is entering a phase focused on reliability, security, maintainability and user
experience. It already provides a broad set of capabilities. The priority is to consolidate that
foundation, improve its overall quality, and make it easier for users and external contributors
to adopt and understand.

## Priorities for 2027

The following areas guide decisions; their order is not a delivery sequence. They may progress
in parallel or change as practical needs emerge.

### Reliability and security hardening

- Strengthen regression testing of critical workflows, including chat, project switching,
  document operations and the integrated terminal.
- Improve resilience to failures, interrupted operations and reconnections, with checks that
  observe the resulting state in the running application.
- Review authentication, file confinement, shell isolation and the trust placed in extensions
  and MCP servers; document both enforced controls and residual risks.
- Continue improving supply-chain security and the evidence behind OpenSSF assessments. The
  [OpenSSF status and plan](openssf.md) tracks the specific controls and remaining gaps.

### Architecture and maintainability

- Reduce complexity and coupling in core modules through focused changes supported by regression
  tests, rather than a wholesale rewrite.
- Clarify internal interfaces and contracts so changes remain easier to reason about and verify.
- Improve architectural documentation, including component responsibilities and trust boundaries.
- Strengthen traceability between requirements, design decisions and meaningful automated checks.

### User experience and accessibility

- Establish a more consistent visual design across the standalone application and embedded views.
- Improve navigation and usability across the main chat, file and document workflows.
- Improve keyboard navigation, focus handling and responsive layouts, checking these in the
  running application alongside automated accessibility scans.
- Make errors, progress and recovery actions clearer, especially when an operation fails or its
  context changes while it is running.

### Contributions and release maturity

- Make setup and onboarding easier for occasional contributors, with focused tasks and clear
  expectations for tests and documentation.
- Welcome independent human reviews when reviewers are available. This is an invitation to
  contribute, not a commitment to establish a team or shared maintenance.
- Clarify supported versions, compatibility expectations and migration guidance. Support remains
  governed by the [security policy](../SECURITY.md#supported-versions).
- Keep contribution and release practices proportionate to an individual project's capacity.

## Development principles

- **Quality over feature count.** New capabilities should address demonstrated user needs.
- **Security by design.** Security controls should be automated and verifiable wherever possible.
- **Evidence-based verification.** Claims about requirements must be supported by meaningful
  tests that observe the relevant outcomes.
- **Sustainable maintenance.** Architectural simplicity and manageable maintenance costs guide
  design choices.
- **Community-informed evolution.** Contributions and real-world feedback inform priorities;
  the maintainer decides scope and acceptance under the [governance model](../GOVERNANCE.md).

## Outside the current plan

- Broad expansion into unrelated capabilities without a demonstrated use case.
- A wholesale architectural rewrite as a goal in itself.
- Long-term support branches or guaranteed security backports for older releases.
- Fixed delivery dates, a guaranteed release cadence or response-time service agreements.
- Building a team or delegating maintenance responsibilities on a promised timetable.

These boundaries describe current intentions. They can change through an explicit update to
this roadmap; feature requests alone do not change the scope or create a delivery commitment.

## Feature requests and review

New features remain welcome, particularly when they address concrete use cases. Major additions
are evaluated against their maintenance cost, architectural impact, security implications and
alignment with this direction. A feature can be useful and still be deferred or declined when
its ongoing cost exceeds the project's capacity.

The maintainer revisits this roadmap as needs, feedback and available time change, without a
fixed review schedule. Substantial proposals can be discussed through issues before implementation;
changes to the roadmap are recorded through pull requests. See the
[contribution guide](../CONTRIBUTING.md#before-starting).
