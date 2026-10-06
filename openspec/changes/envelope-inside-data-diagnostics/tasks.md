## 1. Contract gate

- [x] 1.1 Reproduce: a document with `schema` and `kind` inside `data` is refused with version 1's graph, sequence and table diagnostics and nothing about the envelope.
- [x] 1.2 Lead the schema-stage refusal with `envelope-inside-data`, adding and removing nothing else (spec: AMisplacedEnvelopeLeadsTheRefusal, AFieldInBothPlacesIsNotMisplaced, NoVerdictMoves).
- [x] 1.3 Check it reaches the agent, the reference validator and `show_structure` (spec: TheAgentReadsTheMisplacedEnvelopeFirst, TheReferenceValidatorNamesTheMisplacedEnvelope, AMisplacedEnvelopeIsNamedFirstByShowStructure).

## 2. Planning gate

- [x] 2.1 Settle the envelope before the contract in `judgePlanning`, with the same rule (spec: AMisplacedEnvelopeIsNamedWithTheRest, AMisplacedEnvelopeIsRefusedEvenWhenTheRestIsValid, AWrongEnvelopeIsAnsweredWithTheEnvelopeAlone, AnotherKindIsRefused, AMisplacedEnvelopeIsNamedInTheAnswer).

- [x] 2.2 Point a refusal with a misplaced envelope to the guide page for the kind written inside `data` (spec: AMisplacedEnvelopePointsToWhatTheDocumentMeant).

## 3. Documentation and running servers

- [x] 3.1 `docs/openwebui.md`, `docs/structured-exchange.md`, `shared/conformance/README.md`.
- [x] 3.2 Drive the running Open WebUI server with the reported payload, its corrected form and malformed inputs.
