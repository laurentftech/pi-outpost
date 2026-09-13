## Why

A project has one data model — in the case that motivates this, the one its requirements tool
(DOORS) holds: which object types exist, which attributes each carries, and which values each
enumeration allows. The agent extracts into that model and proposes changes to it. Today nothing
holds it to the model. `profile` on a version 2 envelope is a name and nothing more, so an agent can
invent an enumeration value, drop an attribute the model requires, or type a requirement with a kind
the model does not have, and the only defence is a reader noticing during approval.

The refusal loop that makes the core contract usable by a language model — refuse with the rule and
a pointer, let the agent correct within the turn — is exactly the mechanism a data model needs. What
is missing is a way for the project to declare its model locally, and for the loop to apply it.

## What Changes

- **A project may declare structured-exchange profiles.** A registry file at
  `.pi-outpost/structured-exchange.json` in the project lists profile files kept in the project and,
  optionally, a default profile. Everything is read from the project's own files: nothing is
  fetched, and a profile identifier is still matched as an exact string, never resolved.
- **A published profile format**, `urn:structured-exchange-profile:1`, with a committed JSON Schema.
  A profile declares, for graphs and tables, the element, relationship, row and relation kinds that
  exist; for each kind, its attributes with a type, whether they are required, and — for enumerations
  — the allowed values and whether the enumeration is closed or open; and the viewpoints the domain
  reads its models by, in the shape documents already use. The format is deliberately flat, because
  profiles will be written outside this application — exported from a requirements tool or composed
  by an agent — and reviewed by hand.
- **`present_structure` holds a document to its profile.** A version 2 document naming a registered
  profile — or naming none, in a project with a default — is refused, with the rule and a pointer,
  when it uses a kind the profile does not declare, an attribute the kind does not have, a value of
  the wrong type, a value outside a closed enumeration, or omits a required attribute. A value outside
  an open enumeration is accepted and reported back to the agent. In a project with a default
  profile, a document naming an unregistered profile, and a version 1 document, are refused, since
  either would otherwise step around the model.
- **`write_structure_figure` applies the same profile**, refuses to draw a document that strays from
  it, and resolves a `viewpoint` the document does not declare from its profile's viewpoints.
- **A profile that cannot be used is refused loudly, never skipped.** A malformed registry, a missing
  or malformed profile file, or a default naming no registered profile makes both tools refuse every
  document with the registry's own rule and pointer. Falling back to an unconstrained contract would
  silently undo the guarantee.
- **The reference validator checks profiles where they are built.** The standalone
  `validate-structured-exchange` gains checking a profile file on its own, validating a document
  against a profile, and printing a profile as a readable listing — every kind, attribute and
  enumeration value — for the review by hand no machine can do against the source model.
- **The reader is told.** A presented document states whether it conforms to the project's profile,
  and how many values fell outside open enumerations.

Out of scope, each named so it is not mistaken for forgotten:
- Producing a profile from DOORS or any other tool. That happens outside this application; this change
  publishes the format and the checks it will be built against.
- Constraining sequence documents. Profiles cover graphs and tables, the two shapes the data model
  motivates; sequences are presented as today, profile or not.
- Relationship endpoint rules (which kinds a relationship may connect), cardinalities, and attribute
  constraints beyond type, presence and enumeration.
- Offering a profile's viewpoints in the reader's selector. The agent's figures use them in this
  change; the reader keeps selecting the viewpoints a document declares.
- Checking documents a person opens from the file browser against the profile.
- Profiles shared across projects, inherited from one another, or retrieved from anywhere.

## Capabilities

### New Capabilities

- `structured-exchange-profiles`: the project-local registry and the published profile format; what
  holding a document to a profile refuses and what it only reports; how an unusable registry fails;
  the profile's viewpoints in the agent's figures; the reference validator's profile checks and
  readable listing; and the conformance statement a reader sees.

### Modified Capabilities

- `structured-exchange-context`: `OpaqueOptionalProfile` distinguishes the core contract, which still
  treats a profile as opaque and never refuses one for being unknown, from a project that registers
  profiles, whose tools hold documents to them.
- `structured-exchange-viewpoints`: `TheAgentCanWriteAFigureForAViewpoint` resolves a viewpoint the
  document does not declare from the profile the document is held to.

## Impact

- `shared/schemas/structured-exchange-profile-1.json` — new committed schema; a copy shipped with the
  skill and in the packaged contract.
- `shared/src/` — profile model, profile validation (the profile itself) and conformance checking (a
  document against a profile), with ceilings; shared by the server and the reference validator.
- `server/src/` — reading and confining the project registry per workspace;
  `structuredExchangeTool.ts` and `structuredExchangeFigureTool.ts` apply it, so `present_structure`
  stops being one tool shared by every workspace and is built per workspace like the figure tool
  (`index.ts`, `sandbox.ts`, `piOutpostTools.ts`).
- `shared/src/protocol.ts`, `server/src/convert.ts`, `server/src/index.ts` — an optional conformance
  statement travels beside `structured`, live and on replay. The document itself is unchanged.
- `ui/src/presentations/StructuredExchangeView.tsx` — the conformance statement.
- `shared/bin/validate-structured-exchange.mjs` and its bundle — the profile options.
- `skills/structured-exchange/SKILL.md`, `docs/structured-exchange.md` (whose "will not check your
  profile's own rules" becomes true of the core only) — the registry, the format and the checks.
- No change to the structured-exchange schemas, the conformance corpus or the version 1 lock.
