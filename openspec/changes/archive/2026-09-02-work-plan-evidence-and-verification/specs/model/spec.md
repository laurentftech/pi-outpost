## MODIFIED Requirements

### Requirement: Work Plan protocol state
The typed server protocol SHALL carry the current session Work Plan in authoritative state snapshots and SHALL broadcast accepted Work Plan changes to connected clients. The serialized form SHALL include stable task IDs, hierarchy, status, dependencies, generic resources, status reason, and each task's generic evidence records including their result; it SHALL not expose UI-specific markup, provider-specific evidence fields, or domain-specific resource types.

#### Scenario: Snapshot supplies Work Plan
- **WHEN** a client connects to a session whose Work Plan contains successful and unsuccessful task evidence
- **THEN** its initial authoritative state includes the exact plan, evidence records, and results

#### Scenario: Change reaches all clients
- **GIVEN** two clients display the same session
- **WHEN** the agent accepts a Work Plan evidence change
- **THEN** both clients receive the same updated authoritative plan including the exact evidence records and results

