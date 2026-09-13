## Context

See proposal.md for why. The facts that shape the approach:

- `present_structure` (`server/src/structuredExchangeTool.ts`) validates with
  `parseSerializedStructuredExchange` and returns an error result listing `rule at pointer: message`. It is
  built **once** at module level in `server/src/index.ts` and shared by every workspace, because until
  now it read nothing ("no path argument to confine"). A registry is per project, so that stops being
  true.
- `write_structure_figure` is already built per workspace with a `cwd` — through `readFactories` in
  `server/src/sandbox.ts`, in `index.ts` when unsandboxed, and in `server/src/piOutpostTools.ts` for RPC
  children.
- A presented document reaches the interface as `structured`, which is `JSON.stringify(details)`
  (`server/src/convert.ts` `structuredExchangeField`), live from `index.ts` and on replay from
  `convert.ts`. Both call sites know the workspace. The document must stay byte-exact: an approved
  proposal is handed on as validated.
- The v2 contract calls `profile` opaque (`OpaqueOptionalProfile`) and permits "a receiving authority"
  to validate further. Its docs say the core "will not check your profile's own rules".
- "Profile" is **already a word in this codebase**: configuration profiles, `pi-outpost --profile work`,
  stored in `~/.config/pi-outpost/profiles/`.
- The reference validator `shared/bin/validate-structured-exchange.mjs` is bundled to run with nothing
  but Node, with documented exit codes 0/1/2/3 (`ReferenceValidationAvailableToProducers`).
- Profiles will be produced outside this application — by a DOORS export if one proves possible,
  otherwise by an agent — and their completeness, enumeration values above all, checked by hand.

## Goals / Non-Goals

**Goals:**
- One conformance check, in `shared`, used identically by both tools, the reference validator and the
  reader's statement.
- Everything a profile author needs is available where the profile is built: the schema, a check, a
  readable listing.
- No path by which a misconfigured or circumvented registry quietly means "unconstrained".

**Non-Goals:**
- Changing the structured-exchange schemas, their generated browser validator, or the conformance
  corpus. The browser never evaluates profiles; it displays the server's statement.
- Caching or watching profile files.

## Decisions

### D1. An explicit registry file, not a scanned directory

`.pi-outpost/structured-exchange.json` lists profile files by relative path and may name a default:

```json
{
  "profiles": ["profiles/requirements.json"],
  "default": "acme/requirements"
}
```

A scanned `profiles/` directory would make any stray JSON file a rule, and a deleted file would silently
lift a constraint; listing makes a missing file a loud error (D5). The name is chosen against the
existing configuration profiles: nothing is called `profiles/` at the top of `.pi-outpost/`, and docs
always say "structured-exchange profile". The registry has its own small schema,
`urn:structured-exchange-profile-registry:1`, so its errors carry pointers like a profile's.

Alternatives: server configuration (`pi-outpost.config.json`) — rejected, the model belongs to the
project and should be versioned with it, and one server serves several projects; a directory scan —
rejected above.

### D2. A flat declarative format of our own

```json
{
  "schema": "urn:structured-exchange-profile:1",
  "id": "acme/requirements",
  "label": "ACME requirements model",
  "elementKinds": {
    "requirement": {
      "attributes": {
        "status":   { "type": "enumeration", "values": ["draft", "approved", "withdrawn"], "closed": true, "required": true },
        "priority": { "type": "enumeration", "values": ["must", "should", "could"], "closed": false },
        "owner":    { "type": "string" },
        "verifiedBy": { "type": "reference", "list": true }
      }
    }
  },
  "relationshipKinds": { "derives": {}, "satisfies": {} },
  "viewpoints": [
    { "id": "safety", "label": "Safety", "concern": "What is safety-relevant", "elementKinds": ["requirement"] }
  ]
}
```

- `elementKinds` govern graph elements **and** table rows; `relationshipKinds` govern graph relationships
  **and** table relations. A requirement is the same thing drawn as a box or listed as a row, and these are
  the names viewpoints already use.
- Attribute types: `string`, `number`, `boolean`, `reference`, `enumeration`; `list` and `required`
  default to false; `closed` is required on an enumeration, so an author never gets open or closed by
  omission. Enumeration values are strings (DOORS enumerations are), bounded like attribute strings.
- `null` is accepted for a non-required attribute and refused for a required one: v2 makes `null` an
  ordinary value, so "required" has to mean "has a value".
- Profile viewpoints reuse `StructuredViewpoint` unchanged, validated against the profile's vocabulary
  rather than a document's.

Alternatives: JSON Schema fragments per kind — rejected, it reopens `$ref` (and so retrieval), and its
errors are about schema keywords, not "the profile allows draft, approved, withdrawn"; OSLC resource
shapes — rejected as the format, it ties the application to RDF and to one tool family, though a
converter from them is a plausible way to *produce* a profile.

### D3. An authority pass after the core contract, in `shared`

`shared/src/structuredExchangeProfile.ts` holds the profile and registry types, the profile's own
validation (schema via the Node schema checker plus semantic rules: duplicates, empty or repeated
enumeration values, viewpoint kinds, ceilings), and `checkAgainstProfile(envelope, profile)` returning
refusals and open-enumeration notes. It runs only on an envelope the core already accepted
(`CoreViolationsAreReportedFirst`), so it can walk validated shapes without re-checking them.

Rule identifiers are namespaced so they cannot be mistaken for contract rules: `profile/undeclared-kind`,
`profile/missing-kind`, `profile/undeclared-attribute`, `profile/attribute-type`,
`profile/closed-enumeration`, `profile/missing-required-attribute`,
`profile/required-attribute-removed`, `profile/unregistered-profile`, `profile/version-1-under-default`,
`profile/viewpoint-declared-twice`; and `registry/*` and `profile-format/*` for unusable registries and
profiles. Every refusal message states what is allowed at the pointer (D2's reason for existing).

Proposals: required attributes are enforced only on complete documents; a proposal is checked on the values
it carries and refused when its `removeAttributes` names a required one.

### D4. Read on every check, confined, bounded

The registry and its profiles are read from disk on every tool call and every statement: files are small,
calls are rare relative to their cost, and a cache would bring back the "which version of the profile did
this use" question for no measurable gain. Paths are resolved with the file browser's confinement
(`realResolve` + `isWithin` against the workspace root), and files are size-capped before parsing. Only
the workspace root is used — a sandbox's read exceptions do not widen where a registry may come from.

### D5. Unusable means refuse everything

An unusable registry makes both tools refuse every document with the registry's rule, file and pointer.
The alternative — log and fall back to the core contract — is the one failure this feature cannot have:
a typo in a registry would silently remove every guarantee while everything looked green.

### D6. A default closes the ways around

Without a default, profiles are opt-in per document and the opaque-profile behaviour holds. With one, a
document naming no profile is held to it, naming an unregistered one is refused, and a version 1 document
(which cannot name one) is refused. Otherwise an agent refused by the profile could "fix" its document by
deleting `profile` or downgrading `schema`, and the loop would teach it to.

### D7. `present_structure` becomes a per-workspace tool

`createStructuredExchangeToolDefinition` takes the workspace root and joins the figure tool in
`readFactories` (sandbox), the unsandboxed branch of `index.ts`, and `createPiOutpostTools`. The
module-level singleton and its comment go. Its success text gains the profile checked against and the
open-enumeration notes; its description tells the agent the project may hold documents to a profile.

### D8. The reader's statement travels beside `structured`, and is re-established

`tool_end` and the tool chat item gain an optional `structuredConformance`:
`{ profile: string; state: "conforms" | "strays" | "unchecked"; openValues: number }`. It is computed where
`structured` is built, live and on replay, against the registry as it is then.

Putting it in `details` would change the channel whose one property is carrying the validated envelope;
putting it in the tool's text would make it prose the interface has to parse. Recomputing on replay rather
than recording is deliberate: a profile tightened since tells the reader a proposal made under the old one
no longer conforms, which is what a reviewer needs to know before approving it.

### D9. Profile checks in the reference validator

The same bundle gains:

```
validate-structured-exchange --check-profile profile.json
validate-structured-exchange --profile profile.json [doc.json]
validate-structured-exchange --describe-profile profile.json
```

Exit codes 0–3 keep their meanings for the document; **4** means the profile itself is unreadable, not
JSON, or does not conform. `--describe-profile` prints plain text grouped by vocabulary → kind → attribute,
every enumeration value on its own line, `closed`/`open` and `required`/`list` spelled out; it is the
artifact for the review by hand, so it elides nothing and sorts nothing the author did not order.

### D10. Viewpoints: document first, profile second, never both

The figure tool looks a viewpoint up in the document, then in its profile. The same identifier in both is
refused (`profile/viewpoint-declared-twice`) when the document is held to the profile, so neither tool
guesses. A profile viewpoint retaining nothing present in the document is refused at figure time: a
document's viewpoints are refused for that at validation (`unresolved-viewpoint-kind`), and a profile's
cannot be, since the profile is written for every document.

## Risks / Trade-offs

- [A profile is incomplete — an enumeration value DOORS has and the profile lacks] → the agent is refused
  for a correct value. The refusal lists the allowed values, so the gap is visible in one reading, and
  `--describe-profile` exists for catching it before use.
- [Refusing version 1 under a default surprises an existing project] → only a project that has written a
  registry with a default is affected, and the refusal says what to do.
- [Large tables make the check slow] → the check is linear in items and attributes, over documents already
  bounded by the core ceilings; profile ceilings bound the lookup tables.
- [The reader's statement changes between reloads] → intended (D8), and the statement says "no longer
  conforms" rather than silently disappearing.
- [Word collision with configuration profiles] → path and docs vocabulary chosen against it (D1); the
  `--profile` flag of the reference validator lives on a different binary from the server's `--profile`.
- [`present_structure` built per workspace adds a tool instance per session] → the figure tool already
  does this; construction is a closure over a path.
