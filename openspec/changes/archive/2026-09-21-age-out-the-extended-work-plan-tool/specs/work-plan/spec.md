## ADDED Requirements

### Requirement: The extended Work Plan tool is withdrawn once the plan stops being worked

Holding a Work Plan SHALL be necessary for the extended tool to be published, and SHALL
NOT on its own be sufficient to keep it published. A session that has gone five
consecutive turns without touching its plan SHALL stop being sent the extended tool's
schema, and SHALL keep being sent the common one.

Five, and never the single idle turn an extractor published on a guess is given. The
extractor threshold pays back a wrong inference — a document named in passing that was
never opened — and the inference here is not wrong: the tool is published because a plan
exists, which the persisted plan states rather than suggests. Work on a plan comes in
bursts, and the turns between them are not evidence that the plan is over.

A turn that calls either Work Plan tool SHALL NOT count as one of the idle turns, and a
successful call SHALL reset the count. Where the extended tool has already been
withdrawn, a successful call to the common tool SHALL republish it within that turn, so
the very next request to the model carries it.

This SHALL be safe to do precisely because the way back does not depend on the user: the
common tool is never withheld, and it names the extended half. A document extractor has
no such path, which is why withdrawing one may only be undone by naming the document
again.

Where a runtime cannot change its published toolset, the extended tool SHALL remain
published throughout, as it does today — there is no count to keep and nothing to
withdraw.

#### Scenario: A plan that is being worked keeps the extended tool
- **GIVEN** a session that has just created a Work Plan
- **WHEN** four further turns pass without touching the plan
- **THEN** every request in that span carries the extended tool

#### Scenario: A plan nobody touches loses the extended tool
- **GIVEN** a session publishing both Work Plan tools
- **WHEN** five consecutive turns pass without touching the plan
- **THEN** the next request carries the common tool and not the extended one
- **AND** the persisted plan is unchanged

#### Scenario: The agent brings the extended tool back by itself
- **GIVEN** a session whose extended tool has been withdrawn for want of use
- **WHEN** the agent calls the common Work Plan tool
- **THEN** the extended tool is published again within that turn
