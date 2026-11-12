## ADDED Requirements

### Requirement: Resuming restores recently used document tools
The embedded runtime SHALL reconstruct recently used deferred tools and their idle counters from the selected session branch. Reopening a session SHALL NOT reset its idle clock. Compaction SHALL NOT discard the branch evidence needed for restoration. A new branch SHALL NOT inherit tools from another branch.

#### Scenario: A PowerPoint extraction survives session resume
- **GIVEN** a PowerPoint extractor used once followed by four idle turns
- **WHEN** the conversation is resumed and the user says "Reuse the tool" without naming the file
- **THEN** the first model request declares the extractor and the same call returns the presentation content

#### Scenario: Resume preserves expiry and branch isolation
- **GIVEN** an extractor unused for five turns, or a new empty conversation
- **WHEN** the conversation is resumed
- **THEN** no extractor schema is restored from expired work or another branch

### Requirement: A remembered deferred tool can be called directly
The embedded runtime SHALL execute explicit calls to registered callable deferred tools even when their schemas are not declared. It SHALL republish the called tool, retain SDK validation and extension hooks, and apply the existing sandbox. It SHALL NOT resolve unknown or unavailable tools.

#### Scenario: An expired extractor is reused without a search
- **GIVEN** a PowerPoint extractor whose schema expired after five idle turns
- **WHEN** the model repeats its previous call directly without tool_search
- **THEN** the presentation content is returned and the extractor is declared in the following request

#### Scenario: Direct reuse preserves refusals
- **WHEN** a model calls an unknown tool or a deferred extractor on a path outside the sandbox
- **THEN** the unknown tool remains unknown and the outside path is refused
