# structured-exchange Specification

## Purpose
Carries structured data between a tool and this application in both directions — describing what an
external authority holds, or proposing how it should change — so that a reader can approve a proposal
from what is shown and a producer can validate against a published contract instead of inferring one
from a rendering.

## Requirements

### Requirement: PublishedVersionedSchema

The system SHALL publish the following JSON Schema as the normative contract for version 1 of the
exchange envelope. Each supported major version SHALL be a Git-tracked source file, committed with
the implementation and its tests, carrying a stable version-specific `$id`. The runtime SHALL
validate against its committed copy and SHALL NOT retrieve a schema over the network. An
implementation MAY derive internal types from the schema, but those types SHALL NOT replace it as the
interchange contract.

The system SHALL also bound the size of a candidate document before parsing it, so that an oversized
document is refused rather than materialised. That bound is not expressible in the schema and is
stated as a separate check.

Containers, membership, and a table row's declared role are optional additions to this version
rather than a new one. Every document valid before them SHALL remain valid, a document that declares
none of them SHALL be indistinguishable from one written before they existed, and a table row SHALL
remain expressible as a bare array of cells. This is only sound while no consumer outside this
repository holds a copy of the contract; once one does, an addition of this kind SHALL take a new
version instead, because a published identifier that changes meaning is not an identifier.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:structured-exchange:1",
  "title": "Structured exchange envelope v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema",
    "kind",
    "data"
  ],
  "$defs": {
    "ref": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "localId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200
    },
    "label": {
      "type": "string",
      "maxLength": 500
    },
    "container": {
      "description": "A named group of elements or participants. Grouping only: relationships connect elements and cross container boundaries freely, and a container carries no relationship of its own.",
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id",
        "label"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/localId"
        },
        "label": {
          "$ref": "#/$defs/label"
        },
        "kind": {
          "$ref": "#/$defs/kind"
        }
      }
    },
    "kind": {
      "description": "The producing tool's type or stereotype for this thing \u2014 'block', 'sensor', 'power', 'thermal'. Free text, because the vocabulary belongs to the domain and not to this contract. Carries meaning, not presentation: a reader may colour by it, and a consumer may map it back to its own type system.",
      "type": "string",
      "minLength": 1,
      "maxLength": 100
    },
    "element": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "id"
      ],
      "properties": {
        "id": {
          "$ref": "#/$defs/localId"
        },
        "ref": {
          "$ref": "#/$defs/ref"
        },
        "label": {
          "$ref": "#/$defs/label"
        },
        "kind": {
          "$ref": "#/$defs/kind"
        },
        "set": {
          "$ref": "#/$defs/elementChange"
        },
        "container": {
          "$ref": "#/$defs/localId"
        }
      },
      "if": {
        "not": {
          "required": [
            "ref"
          ]
        }
      },
      "then": {
        "required": [
          "label"
        ]
      }
    },
    "edge": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "from",
        "to"
      ],
      "properties": {
        "from": {
          "$ref": "#/$defs/localId"
        },
        "to": {
          "$ref": "#/$defs/localId"
        },
        "kind": {
          "$ref": "#/$defs/kind"
        },
        "ref": {
          "$ref": "#/$defs/ref"
        },
        "label": {
          "$ref": "#/$defs/label"
        },
        "set": {
          "$ref": "#/$defs/edgeChange"
        }
      },
      "if": {
        "not": {
          "required": [
            "ref"
          ]
        }
      },
      "then": {
        "required": [
          "kind"
        ]
      }
    },
    "message": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "from",
        "to"
      ],
      "properties": {
        "from": {
          "$ref": "#/$defs/localId"
        },
        "to": {
          "$ref": "#/$defs/localId"
        },
        "ref": {
          "$ref": "#/$defs/ref"
        },
        "label": {
          "$ref": "#/$defs/label"
        },
        "set": {
          "$ref": "#/$defs/messageChange"
        }
      },
      "if": {
        "not": {
          "required": [
            "ref"
          ]
        }
      },
      "then": {
        "required": [
          "label"
        ]
      }
    },
    "removal": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "type",
        "ref"
      ],
      "properties": {
        "type": {
          "enum": [
            "element",
            "relationship"
          ]
        },
        "ref": {
          "$ref": "#/$defs/ref"
        },
        "label": {
          "$ref": "#/$defs/label"
        },
        "kind": {
          "$ref": "#/$defs/kind"
        },
        "from": {
          "$ref": "#/$defs/localId"
        },
        "to": {
          "$ref": "#/$defs/localId"
        }
      },
      "description": "Something to take out of the target, named by the reference the authority knows it by. The other fields describe it and never identify it: they exist so a reader can see what they are approving the removal of. This application holds one document, not the authority's model, so without them a removal is an opaque identifier and the reader is asked to approve the deletion of something they cannot see."
    },
    "elementChange": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "label": {
          "$ref": "#/$defs/label"
        },
        "kind": {
          "$ref": "#/$defs/kind"
        },
        "container": {
          "$ref": "#/$defs/localId"
        }
      }
    },
    "edgeChange": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "kind": {
          "$ref": "#/$defs/kind"
        },
        "label": {
          "$ref": "#/$defs/label"
        }
      }
    },
    "messageChange": {
      "type": "object",
      "additionalProperties": false,
      "minProperties": 1,
      "properties": {
        "label": {
          "$ref": "#/$defs/label"
        }
      }
    },
    "cells": {
      "type": "array",
      "items": {
        "type": [
          "string",
          "number",
          "boolean",
          "null"
        ],
        "maxLength": 1000
      },
      "maxItems": 50
    }
  },
  "properties": {
    "schema": {
      "const": "urn:structured-exchange:1"
    },
    "kind": {
      "enum": [
        "graph",
        "sequence",
        "table"
      ]
    },
    "target": {
      "$ref": "#/$defs/ref"
    },
    "removals": {
      "type": "array",
      "maxItems": 500,
      "items": {
        "$ref": "#/$defs/removal"
      }
    },
    "data": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "nodes",
            "edges"
          ],
          "properties": {
            "nodes": {
              "type": "array",
              "minItems": 1,
              "maxItems": 500,
              "items": {
                "$ref": "#/$defs/element"
              }
            },
            "edges": {
              "type": "array",
              "maxItems": 2000,
              "items": {
                "$ref": "#/$defs/edge"
              }
            },
            "containers": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "$ref": "#/$defs/container"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "participants",
            "messages"
          ],
          "properties": {
            "participants": {
              "type": "array",
              "minItems": 1,
              "maxItems": 100,
              "items": {
                "$ref": "#/$defs/element"
              }
            },
            "messages": {
              "type": "array",
              "maxItems": 1000,
              "items": {
                "$ref": "#/$defs/message"
              }
            },
            "containers": {
              "type": "array",
              "maxItems": 50,
              "items": {
                "$ref": "#/$defs/container"
              }
            }
          }
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "columns",
            "rows"
          ],
          "properties": {
            "columns": {
              "type": "array",
              "minItems": 1,
              "maxItems": 50,
              "items": {
                "type": "string",
                "minLength": 1,
                "maxLength": 200
              }
            },
            "rows": {
              "type": "array",
              "maxItems": 5000,
              "items": {
                "oneOf": [
                  {
                    "$ref": "#/$defs/cells"
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "required": [
                      "cells"
                    ],
                    "properties": {
                      "cells": {
                        "$ref": "#/$defs/cells"
                      },
                      "role": {
                        "enum": [
                          "added",
                          "changed",
                          "context",
                          "removed"
                        ]
                      }
                    }
                  }
                ]
              }
            }
          }
        }
      ]
    }
  }
}
```

#### Scenario: SchemaIsTheContract
- **WHEN** a producer validates a document against the published schema and it passes
- **THEN** the application accepts that document without requiring anything the schema does not state

#### Scenario: ValidationMakesNoNetworkRequest
- **WHEN** the application validates an envelope
- **THEN** validation completes without retrieving a schema over the network

#### Scenario: EnvelopeIsRejectedAgainstThePublishedSchema
- **WHEN** a document omits a required field, carries an undeclared property, or exceeds a declared collection bound
- **THEN** it is rejected and no specialized presentation is produced

#### Scenario: DocumentsWithoutContainersAreUnaffected
- **WHEN** a document that declares no containers and no membership is validated
- **THEN** it is accepted exactly as it was before containers existed

#### Scenario: ARowWrittenBeforeRolesExistedIsStillAccepted
- **WHEN** a table declares its rows as bare arrays of cells, as every document did before roles existed
- **THEN** it is accepted exactly as it was before roles existed

### Requirement: TwoIdentitiesPerElement

An element SHALL carry an identifier scoped to the envelope, which relationships within that envelope
refer to. It MAY additionally carry a reference to an element the receiving authority already holds.

The two SHALL NOT be conflated: the envelope-scoped identifier is a local name, and the reference is
the join to an external artifact. An element that carries no reference SHALL be understood as one the
authority does not yet hold.

The system SHALL treat a reference as opaque. It SHALL NOT parse it, derive meaning from it, or alter
it, and SHALL reproduce it unchanged when the envelope is passed on.

A reference SHALL NOT be assumed unique across kinds of thing: the same string MAY identify an
element in one collection and a relationship in another. Anything naming a reference SHALL therefore
also say what kind of thing it names.

#### Scenario: AReferenceIsQualifiedByWhatItNames
- **WHEN** the same reference string identifies both an element and a relationship
- **THEN** each is addressed unambiguously, and neither is taken to mean the other

#### Scenario: RelationshipsResolveThroughEnvelopeIdentifiers
- **WHEN** a relationship names an endpoint
- **THEN** it is resolved against the envelope's own element identifiers, not against any external reference

#### Scenario: ElementWithoutAReferenceIsNew
- **WHEN** an element in a proposal carries no reference to an existing element
- **THEN** it is presented as an addition rather than as a change to something that already exists

#### Scenario: ReferencesSurviveUnaltered
- **WHEN** an envelope carrying references is displayed and passed on
- **THEN** every reference is reproduced exactly as supplied

### Requirement: ProposalsArePatches

An envelope that names a target SHALL be understood as a proposal to change that artifact, describing
only what changes. An element the proposal does not mention SHALL be understood as untouched; an
omission MUST NOT be interpreted as a removal.

A removal SHALL be declared explicitly, naming both the reference and what kind of thing it removes,
since a reference alone does not say whether it means an element or a relationship. Removals SHALL be
permitted only in a proposal that names a target, since an artifact that does not yet exist has
nothing to remove.

A modification SHALL be declared as such. On something carrying a reference, the fields declared
beside it SHALL be understood as **describing what already exists** — they are there so a reader can
recognise it — and SHALL NOT be applied. An intended change SHALL be stated separately, naming the
fields to change and the values they are to take.

The default SHALL run that way round, and not the other. A producer here may be generative, and it
will sometimes omit the declaration; what matters is what that costs. Were a declared field taken as
an intended change, a producer including twenty elements so the reader could see the surroundings
would be proposing twenty renames to the names those elements already have — and the reader, seeing
them marked as changes with no way to tell, could approve them. With this default the same omission
changes nothing and is noticed as nothing happening. A generative producer's mistakes MUST fail
inert, not destructive.

A change SHALL name something that exists: a change declared on an element or relationship carrying
no reference SHALL be refused, since there is nothing there to change and its fields are already its
values. A change declaring no field SHALL be refused rather than treated as a change of nothing.

It follows that an element or relationship carrying a reference and no declared change is context,
however much it describes: something already held, named and labelled so the reader can place what
surrounds the proposal. The system SHALL NOT present it as modified.

Where a described value and a change to the same field are both present, the system SHALL present
them as a transition from the one to the other. A reader asked to approve a change is entitled to
see what it is changing from.

A relationship's endpoints are its identity, not its state. They SHALL be declared on every
relationship, referenced or not, and declaring them SHALL NOT be read as a request to change them.
Re-attaching a relationship SHALL be expressed as a removal and a creation, not as a patch of its
endpoints.

This is the one place the field rule does not apply, and it is deliberate: the approval view has to
place every relationship it shows, and a relationship whose endpoints were omitted could only be
listed in prose. A reader approving a structural change should see the structure. Restating an
endpoint is safe in a way restating a label is not — an endpoint cannot be changed by restating it,
so a producer that gets one wrong states an inconsistency the receiving authority can detect against
what it already holds, rather than silently overwriting something.

#### Scenario: RelationshipPatchDeclaresItsEndpoints
- **WHEN** a proposal changes an attribute of an existing relationship
- **THEN** it declares that relationship's endpoints alongside its reference, and they are not presented as a change

#### Scenario: ReattachmentIsRemovalAndCreation
- **WHEN** a proposal moves a relationship to a different endpoint
- **THEN** it declares a removal and a new relationship, rather than patching the endpoints of the existing one

An envelope that names no target SHALL be understood as a complete new artifact. The system SHALL
determine which of the two applies from the presence of the target alone, and MUST NOT infer it from
whether references happen to appear, because a proposal that only adds elements carries none.

#### Scenario: OmissionDoesNotRemove
- **WHEN** a proposal names a target and does not mention an element the authority holds
- **THEN** that element is not presented as removed and no removal is proposed for it

#### Scenario: RemovalIsDeclared
- **WHEN** a proposal declares a removal, naming a reference and what kind of thing it removes
- **THEN** it is presented as a removal alongside the rest of the proposal

#### Scenario: OnlyDeclaredChangesChange
- **WHEN** a proposal references an existing element and declares a change to one of its fields
- **THEN** that field is presented as taking the declared value, and no other field of that element is presented as changing

#### Scenario: DescribedFieldsAreNotChanges
- **WHEN** a proposal references an existing element and declares its current name beside the reference, without declaring a change
- **THEN** the element is presented as existing context under that name, and nothing about it is presented as changing

#### Scenario: AChangeNamesSomethingThatExists
- **WHEN** a change is declared on an element or relationship that carries no reference, or declares no field
- **THEN** it is refused, and no specialized presentation is produced

#### Scenario: AChangeIsShownAsATransition
- **WHEN** a proposal declares both a field's current value and a change to it
- **THEN** the reader is shown the move from the one to the other, not merely that something changed

#### Scenario: AReferenceAloneIsContextNotAChange
- **WHEN** a proposal references an existing element and declares no change, so that a new relationship can attach to it
- **THEN** the element is presented as existing context and not as a modification

#### Scenario: AdditionOnlyProposalRemainsAPatch
- **WHEN** a proposal names a target and every element in it is new, so no reference appears anywhere
- **THEN** it is still treated as a patch of that target, not as a complete new artifact

#### Scenario: RemovalWithoutATargetIsRejected
- **WHEN** an envelope declares a removal but names no target
- **THEN** it is rejected and no specialized presentation is produced

### Requirement: OnlySomeKindsMayBeProposed

The supported kinds SHALL be a graph, a sequence, and a table. A graph SHALL declare elements and
directed relationships between them; a sequence SHALL declare participants and ordered messages
between them; a table SHALL declare columns and rows aligned to those columns.

A graph and a sequence SHALL be permitted to name a target and declare removals. A table SHALL NOT:
it is a projection over something else, and cannot be applied. An envelope declaring a table with a
target or a removal SHALL be rejected.

A table SHALL nevertheless be permitted to report, per row, the role that row plays in a change it
projects. Reporting a role SHALL NOT make the table a proposal: no approval, application or handover
path SHALL treat a table as something that can be applied, whatever roles its rows declare.

#### Scenario: TableCarryingATargetIsRejected
- **WHEN** an envelope declares a table together with a target or a removal
- **THEN** it is rejected and no specialized presentation is produced

#### Scenario: TableIsStillRenderedAndReadable
- **WHEN** an envelope declares a table with no target
- **THEN** it is rendered with its declared columns and rows

#### Scenario: TableReportsRolesWithoutBecomingAProposal
- **WHEN** an envelope declares a table whose rows carry roles, and no target
- **THEN** it is accepted, and it is not offered for approval or application

### Requirement: RelationshipsDeclareAnOpaqueKind

Every relationship in a graph SHALL declare a kind. The system SHALL treat that kind as an opaque
string: it MAY display it and MAY use it to distinguish two relationships that connect the same pair
of elements, and it SHALL NOT interpret its meaning, validate it against a fixed vocabulary, or alter
behaviour based on its value.

Two relationships connecting the same pair of elements SHALL be permitted when their kinds differ.

#### Scenario: RelationshipKindIsPreservedAndUninterpreted
- **WHEN** a graph declares relationships whose kinds are unfamiliar strings
- **THEN** they are rendered and distinguished by kind without any kind being rejected as unknown

#### Scenario: ParallelRelationshipsAreDistinct
- **WHEN** two relationships connect the same pair of elements with different kinds
- **THEN** both are presented, and neither replaces the other

### Requirement: ElementsMayDeclareAnOpaqueKind

An element MAY declare a kind, carrying the producing tool's own type or stereotype for it. The
system SHALL treat it as the same opaque string a relationship's kind is: it MAY display it, MAY
group or distinguish elements by it, and SHALL NOT interpret it, validate it against a fixed
vocabulary, or alter behaviour based on its value. A patch MAY change it.

The contract SHALL NOT carry presentation. A document SHALL NOT be able to specify a colour, a
position, or any other appearance, because such a value means nothing to the authority that applies
the proposal and would compete with the presentation of what is changing.

#### Scenario: ElementKindIsOptionalAndUninterpreted
- **WHEN** a document declares element kinds drawn from an unfamiliar vocabulary, and other elements declare none
- **THEN** all of them are accepted, and no kind is rejected as unknown

#### Scenario: ElementKindMayBeChangedByAPatch
- **WHEN** a proposal references an existing element and declares a change to its kind
- **THEN** the change is accepted and presented as a change to that element's type

#### Scenario: PresentationIsNeverCarriedByTheDocument
- **WHEN** a document attempts to declare an appearance for an element or relationship
- **THEN** it is refused as an undeclared property rather than honoured

### Requirement: ContainersGroupWithoutMediating

A graph or a sequence MAY declare containers: named groups, each carrying an identifier scoped to the
envelope and a label, and optionally a kind. A container SHALL be declared once and referred to by its
members.

Membership SHALL live on the member. An element or a participant MAY name exactly one container, and
SHALL be understood as belonging to no container when it names none. A member SHALL NOT name more
than one container, which the single-valued field makes true by construction rather than by rule.

A container SHALL NOT contain another container in this version. Nesting is not expressed by any
other means in the meantime — a member names a container, never a chain of them.

A container SHALL group and SHALL NOT mediate. Relationships and messages connect elements, and they
SHALL be unaffected by grouping: an endpoint SHALL NOT name a container, and a relationship between
members of different containers SHALL be as ordinary as one within a single container. Removing every
container from a document SHALL leave the same elements connected the same way.

A container that no member names SHALL be valid. A producer builds a document incrementally, and a
proposal that adds a group before it adds anything to it is a coherent intention, not an error.

A proposal MAY change which container a member belongs to, in the same way it declares any other
change to that member.

#### Scenario: MembershipIsSingleValued
- **WHEN** an element declares the container it belongs to
- **THEN** it belongs to that one container, and there is no way for it to declare a second

#### Scenario: AnElementNeedNotBelongAnywhere
- **WHEN** a document declares containers and an element names none of them
- **THEN** the document is valid and that element belongs to no container

#### Scenario: RelationshipsCrossContainersFreely
- **WHEN** a relationship connects elements that belong to different containers
- **THEN** it is treated exactly as a relationship between two members of the same container

#### Scenario: ContainersCannotBeEndpoints
- **WHEN** a relationship or message names a container as an endpoint
- **THEN** the document is rejected, because a container identifier is not an element identifier

#### Scenario: AnEmptyContainerIsValid
- **WHEN** a document declares a container that no member names
- **THEN** the document is accepted

#### Scenario: AProposalMayMoveAMember
- **WHEN** a proposal declares that an existing element now belongs to a different container
- **THEN** that is presented as a change to that element, like any other declared change

### Requirement: MutationRequiresATarget

A declared change SHALL be refused when the envelope names no target. Naming a target is what makes a
document a proposal, and a change in a document that claims to describe a new artifact asks an
authority to mutate something the reader was never shown as changing.

Fields whose presence asserts that a document is a proposal SHALL be refused on a kind that cannot be
proposed, and SHALL be refused on their presence rather than on their contents.

#### Scenario: ChangeWithoutTargetIsRefused
- **WHEN** an element or relationship declares a change and the envelope names no target
- **THEN** the document is refused, naming the rule and pointing at the change

#### Scenario: EmptyProposalFieldsAreStillRefusedOnAProjection
- **WHEN** a projection declares a removals list that is empty
- **THEN** the document is refused, because declaring the field at all asserts that it is a proposal

### Requirement: SemanticValidationAfterSchemaValidation

The system SHALL perform deterministic semantic validation after schema validation, verifying that
element identifiers are unique within the envelope, that every relationship and message endpoint
resolves to a declared element, that every container identifier is unique within the envelope, that
every membership names a container the same envelope declares, that every row has one value per
declared column, that the declared kind agrees with the shape of the data, that a target and removals
appear only where permitted, that a removal names a kind of thing the declared data kind can contain,
and that no removal names a reference the same envelope also declares — a proposal that both changes
and removes the same thing states two intentions at once and SHALL be refused rather than resolved by
precedence.

Neither validation stage SHALL repair, complete, or guess at invalid data. A document that fails
either stage SHALL yield no structured result. In particular, a membership naming an undeclared
container SHALL NOT be dropped so that the rest of the document can render: silently ungrouping an
element misstates the system being described.

#### Scenario: SchemaValidButSemanticallyInvalidIsRejected
- **WHEN** a document passes schema validation but repeats an element identifier, names an endpoint that is not declared, declares a kind that disagrees with its data, or has a row whose length differs from its columns
- **THEN** it is rejected and no partial view is produced

#### Scenario: MembershipInAnUndeclaredContainerIsRejected
- **WHEN** an element or participant names a container the envelope does not declare
- **THEN** the document is rejected, rather than rendered with that element ungrouped

#### Scenario: RepeatedContainerIdentifierIsRejected
- **WHEN** two containers in one envelope declare the same identifier
- **THEN** the document is rejected

#### Scenario: ValidationNeverRepairs
- **WHEN** a document is invalid in a way that could be guessed at, such as a relationship endpoint close to a declared identifier
- **THEN** no correction is attempted and no structured result is produced

#### Scenario: ContradictoryProposalIsRefused
- **WHEN** a proposal declares a change to a reference and also declares that same reference removed
- **THEN** it is refused rather than resolved in favour of either intention

### Requirement: BoundedDocument

The system SHALL bound a candidate document's total size and SHALL apply that bound before parsing
it, so that an oversized document is refused rather than materialised. Every string the schema
carries — references, identifiers, labels, relationship kinds, column names, and cell values — SHALL
be bounded as well as every collection.

Bounds SHALL exist at two levels. The schema SHALL carry a **ceiling** for each collection and
string: stable for the life of a schema version, and what any producer may assume is accepted
wherever that version is supported. A deployment MAY additionally apply an **operational limit** at
or below the ceiling, so that limits can be calibrated against real traffic without changing the
published contract or requiring a version. A limit above its ceiling SHALL have no effect.

A refusal SHALL be actionable for whoever must adjust it: it SHALL report the observed value, the
limit applied, and which of the two levels the document exceeded. Exceeding a bound SHALL NOT
produce a truncated document or a partial view.

The system SHALL record the observed size of documents it **accepts**, so an operational limit can be
set from evidence rather than from a first refusal.

#### Scenario: OversizedDocumentIsRefusedBeforeParsing
- **WHEN** a candidate document exceeds the total size bound
- **THEN** it is refused without being parsed, and no structured result is produced

#### Scenario: UnboundedStringIsRefused
- **WHEN** a label, reference, relationship kind, column name, or cell value exceeds its bound
- **THEN** the document is refused, and nothing is truncated

#### Scenario: RefusalIdentifiesTheLimitThatBit
- **WHEN** a document is refused for exceeding a bound
- **THEN** the diagnostic reports what was exceeded, the observed value, the limit applied, and whether that limit was the schema's ceiling or the deployment's own

#### Scenario: OperationalLimitIsStricterThanTheCeiling
- **GIVEN** a deployment applying an operational limit below the schema's ceiling
- **WHEN** a document exceeds that limit while remaining within the ceiling
- **THEN** it is refused, and the diagnostic attributes the refusal to the deployment rather than to the published contract

#### Scenario: AcceptedSizesAreObservable
- **WHEN** documents are accepted over time
- **THEN** their observed sizes are recorded, so a limit can be calibrated without waiting for a refusal

### Requirement: TheAgentCanPresentADocument

The system SHALL give the agent a way to present a structured-exchange document it
composed itself. Without one the contract is open only to producers that implement tools,
and the agent — which authors documents on request — could describe one and never show it.

That path SHALL validate the document exactly as a received one is validated, and SHALL
NOT present anything that fails. A refusal SHALL be returned to the agent as an error
carrying the same diagnostics a producer would receive, so it can correct the document
and present it again within the same exchange.

The agent SHALL be required to supply a summary alongside the document, because the
structured payload does not reach it on a later turn and a document it can no longer
read is one it cannot answer questions about.

#### Scenario: AgentPresentsAValidDocument
- **WHEN** the agent supplies a valid document and a summary
- **THEN** the document is presented, and the summary is what remains available to the agent afterwards

#### Scenario: AgentReceivesTheDiagnosticsForARefusal
- **WHEN** the agent supplies a document that fails validation
- **THEN** nothing is presented, and the agent is given the rule and the offending value as an error it can act on

#### Scenario: AgentCorrectsAndPresentsAgain
- **WHEN** the agent corrects a document that was refused and presents it again
- **THEN** the corrected document is presented, with no trace of the refused one

### Requirement: ValidatedProposalRemainsRecoverableUnchanged

A validated proposal SHALL remain available for as long as the result carrying it is available, and
SHALL be structurally identical to what was validated: the same elements, relationships, removals and
fields, in the same order, with the same values. Nothing SHALL be added, dropped, reordered, coerced,
truncated, or defaulted — not when validating it, not when rendering it, and not when the reader
adjusts, narrows or exports the rendering.

Byte identity is deliberately **not** promised. The document crosses this process as a parsed value,
so the bytes a producer wrote do not survive to the far side, and a requirement stated in bytes would
be one nothing can keep. What is worth guaranteeing is that no field, no order and no value differs.

There is deliberately no approval action and no handover step in this system. A proposal is shown so
a person can judge it; carrying their decision anywhere is the job of whatever integrates this, and
is outside this contract. What is required here is that when that integration comes to fetch the
document, it finds the document that was shown.

#### Scenario: ValidatedProposalIsRecoverableAsValidated
- **WHEN** a validated document is presented through the tool and recovered from the result that carried it
- **THEN** it is structurally identical to what was validated — same fields, same order, same values — with nothing added, dropped, reordered or coerced

#### Scenario: RenderingAndAdjustingDoNotAlterIt
- **WHEN** a reader repositions the rendering, narrows it to selected kinds, or copies or downloads it
- **THEN** the recoverable document is unchanged by any of it

### Requirement: ReferenceValidationAvailableToProducers

The system SHALL provide a documented reference validation interface usable by a producer that is not
part of this application. It SHALL accept a candidate document from a file or standard input, apply
the published schema and the same semantic validation the application applies, and emit
machine-readable diagnostics. Invalid input SHALL produce a non-zero process status.

The interface and the schema SHALL be usable independently of this application, so that a producer
built elsewhere can validate without reproducing the contract. The interface SHALL be executable
without this application's source, its package manager, or a checkout of it.

Its process status SHALL distinguish a document that does not conform from input that could not be
read and from input that is not the expected encoding, because those send a producer to three
different places.

A successful producer-side validation SHALL NOT exempt the application from validating a received
document again.

#### Scenario: ProducerValidatesBeforeEmitting
- **WHEN** a producer passes a valid candidate document to the reference validation interface
- **THEN** it receives a successful machine-readable result and a zero exit status

#### Scenario: ProducerReceivesActionableDiagnostics
- **WHEN** a producer passes a document whose relationship names an endpoint that is not declared
- **THEN** the interface identifies that failure and exits with a non-zero status

#### Scenario: ApplicationValidatesOnReceipt
- **WHEN** a document arrives that a producer states it has already validated
- **THEN** the application validates it again before rendering it

#### Scenario: TheValidatorRunsWhereTheProducerIs
- **WHEN** the published validation interface is run outside this application, with none of its sources present
- **THEN** it validates a document and reports its verdict

#### Scenario: RefusalIsDistinguishedFromUnreadableInput
- **WHEN** the interface is given a document that does not conform, input it cannot read, and input that is not the expected encoding
- **THEN** each produces a different non-zero process status, and the meaning of each status is documented

### Requirement: ApprovalRenderingShowsWhatWouldChange

A proposal SHALL be rendered as what it would change, not as the resulting state. Additions, changed
elements, and declared removals SHALL be distinguishable from one another in the rendering.

The rendering SHALL show every element the proposal carries. It MUST NOT summarise, sample, or
truncate a proposal that passed validation, because what is shown is what a reader approves.

#### Scenario: ProposalRendersAsItsChanges
- **WHEN** a proposal naming a target is rendered
- **THEN** its additions, changes, and removals are shown and distinguishable

#### Scenario: EveryProposedElementIsShown
- **WHEN** a validated proposal carries the largest number of elements the contract permits
- **THEN** every one of them appears in the rendering, none omitted or summarised

#### Scenario: NewArtifactRendersAsItself
- **WHEN** an envelope naming no target is rendered
- **THEN** it is presented as a complete new artifact rather than as a set of changes

### Requirement: NativeRenderingFromValidatedData

For a validated graph, the system SHALL render every declared element and directed relationship from
the validated data, preserving labels and direction. For a validated sequence, it SHALL render every
participant and message in declared order, preserving direction and label. For a validated table, it
SHALL render columns in declared order and every cell in its corresponding row position.

The system SHALL NOT infer elements, relationships, messages, labels, or meaning from diagram syntax
or from any accompanying text. Layout MAY choose geometry for readability, and geometry SHALL NOT be
presented as data. A document whose relationships form cycles SHALL be laid out at a size proportional
to what it contains, and SHALL NOT be rendered at a scale that makes it illegible.

Producer-supplied text SHALL be rendered as text and never as markup. Every view SHALL expose an
accessible textual equivalent of what it displays.

The textual equivalent SHALL carry everything the visual rendering carries: every element,
participant, relationship and message, including any nothing connects to; every declared kind; every
addition, change and removal; and, for a table, the role each row declares. Where the visual
rendering and the textual equivalent name the same thing, they SHALL name it the same way.

#### Scenario: GraphPreservesDeclaredRelationships
- **WHEN** a valid graph is rendered
- **THEN** exactly the declared elements and directed relationships are displayed

#### Scenario: ACyclicGraphIsStillLegible
- **WHEN** a graph whose relationships form feedback cycles is rendered
- **THEN** its extent stays proportionate to the number of elements it declares, and no element is drawn over another

#### Scenario: SequencePreservesDeclaredOrder
- **WHEN** a valid sequence is rendered
- **THEN** every message appears in its declared order and direction between declared participants

#### Scenario: TablePreservesDeclaredOrder
- **WHEN** a valid table is rendered
- **THEN** columns and each row appear in their declared order

#### Scenario: TheTextualEquivalentOmitsNothingVisual
- **WHEN** a graph or sequence carrying kinds, changes, removals, and a participant no message reaches is presented
- **THEN** the textual equivalent names all of them, using the same names the rendering displays

#### Scenario: ProducerTextRemainsInert
- **WHEN** a label or value contains markup-like text
- **THEN** it is displayed as text and is neither executed nor interpreted as markup

#### Scenario: TheTextualEquivalentOfATableNamesItsRoles
- **WHEN** a table whose rows declare roles is presented
- **THEN** the textual equivalent names each row's role, using the same names the rendering displays

### Requirement: TypeIsDistinguishableFromChange

Where a rendering distinguishes elements or relationships by their declared kind, it SHALL do so
through a channel that does not compete with how it shows what is changing. Two distinct kinds
present in the same rendering SHALL be distinguishable from one another. A rendering SHALL provide a
key naming every kind it distinguishes, and that key SHALL be part of what an export carries.

#### Scenario: EachVocabularyIsBoundedByWhatCanBeDistinguished
- **WHEN** a document declares more distinct element types, or more distinct relationship types, than a rendering can present distinguishably
- **THEN** it is refused, naming the vocabulary, the count and the limit

#### Scenario: TheTwoVocabulariesAreCountedApart
- **WHEN** a document declares the maximum number of element types and the maximum number of relationship types at once
- **THEN** it is accepted, because the two vocabularies are independent and are counted independently

#### Scenario: TwoTypesNeverLookAlike
- **WHEN** a document declares several distinct element or relationship kinds
- **THEN** no two of them are presented identically

#### Scenario: TypeDoesNotObscureChange
- **WHEN** a proposal adds an element whose kind is shared with an element included for context
- **THEN** the addition remains distinguishable from the context element

#### Scenario: TheKeyTravelsWithTheFigure
- **WHEN** a rendering that distinguishes kinds is exported
- **THEN** the exported figure carries the key naming those kinds

### Requirement: ReaderMayAdjustAndNarrowTheView

A reader MAY adjust a rendering for legibility — repositioning what it draws, moving around it,
turning it between landscape and portrait where it has an orientation to choose, and narrowing it to
selected kinds. For a table, the same narrowing SHALL be offered over the roles its rows declare.
Every kind and every role SHALL be shown by default, and the control SHALL be the key
itself, so what a reader reads a colour from is what they switch.

An adjustment SHALL be presentation only: it SHALL NOT alter the document, and SHALL NOT be carried
back to any authority.

While a rendering is narrowed, it SHALL state that it is showing less than the whole document, and
that statement SHALL be part of what an export carries — for a table, of its textual equivalent. For a proposal, the statement SHALL make
clear that what is hidden remains part of the proposal, and a hidden kind SHALL NOT be marked in a
way the same rendering uses for a removal.

#### Scenario: EverythingIsShownUntilTheReaderNarrowsIt
- **WHEN** a rendering that distinguishes kinds is first displayed
- **THEN** every element and relationship of the document is shown

#### Scenario: NarrowingIsReversibleAndDeclared
- **WHEN** a reader hides a kind
- **THEN** the rendering says what it is no longer showing, and offers to show everything again

#### Scenario: ANarrowedProposalStillSaysWhatItProposes
- **WHEN** a narrowed rendering of a proposal is exported
- **THEN** the exported figure states how much of the document it shows and that hidden kinds remain part of the proposal

#### Scenario: ElementAndRelationshipVocabulariesAreIndependent
- **WHEN** an element kind and a relationship kind share the same name and the reader hides one of them
- **THEN** only the one they hid is hidden

#### Scenario: AdjustmentDoesNotAlterTheDocument
- **WHEN** a reader repositions, turns or narrows a rendering
- **THEN** the document recovered for handover is unchanged

#### Scenario: ATableNarrowsByRole
- **WHEN** a reader hides a role in a table that declares roles
- **THEN** only the rows declaring that role stop being shown, the rendering says what it is no longer showing, and it offers to show everything again

#### Scenario: AHiddenRoleIsNotARemovedRow
- **WHEN** a reader hides a role in a table that also declares removed rows
- **THEN** the hidden rows are absent rather than struck through, and the removed rows keep their own marking

### Requirement: EveryDeclaredRelationshipIsPerceptible

Every relationship a validated document declares SHALL be perceptible in the rendering. A
relationship connecting an element to itself SHALL be drawn with extent. Two relationships connecting
the same pair of elements SHALL be drawn distinguishably from one another.

#### Scenario: ASelfRelationshipIsVisible
- **WHEN** a graph declares a relationship from an element to itself
- **THEN** it is drawn as a shape with extent rather than collapsing to nothing

#### Scenario: ParallelRelationshipsAreDrawnApart
- **WHEN** two relationships connect the same pair of elements in the same direction
- **THEN** each is drawn distinguishably from the other

### Requirement: ContainersArePerceptibleWithoutRestyling

Every declared container SHALL be perceptible in the rendering, including one that no member names,
and its label SHALL be shown. A reader SHALL be able to tell which container each member belongs to
from the rendering alone, without consulting the source document.

Containers SHALL NOT change how elements and relationships themselves are drawn. Adding a container
to a document SHALL leave every element and every relationship rendered as it was; grouping adds
geometry around them and takes none away.

In a graph, a container SHALL be drawn as an enclosure holding exactly its members, and every member
SHALL be laid out inside it.

In a sequence, a container SHALL be drawn as a header spanning the columns of its members, and the
column layout below that header — one column and one lifeline per participant, messages in declared
order — SHALL be unchanged. Because a header can only span adjacent columns, the view SHALL order
columns so that the members of a container are contiguous: walking participants in declared order,
the first time a member of a container is met, every member of that container is placed at that
point in its declared order; a participant belonging to no container keeps its place. Containers
therefore appear in order of first mention, and members keep the order they were declared in.

The textual equivalent SHALL state the container each element or participant belongs to, and SHALL
name every declared container including an empty one.

#### Scenario: EveryDeclaredContainerIsVisible
- **WHEN** a document declaring containers is rendered
- **THEN** each container appears with its label, including any container no member names

#### Scenario: GraphMembersAreDrawnInsideTheirContainer
- **WHEN** a graph declaring containers is rendered
- **THEN** every member is drawn within the enclosure of the container it names, and within no other

#### Scenario: SequenceKeepsItsColumnsAndGainsAHeader
- **WHEN** a sequence declaring containers is rendered
- **THEN** each participant still has one column and one lifeline, messages are still in declared order, and each container spans the columns of its own members

#### Scenario: InterleavedMembersAreOrderedContiguously
- **WHEN** a sequence declares participants whose containers alternate, such as a member of A, then a member of B, then another member of A
- **THEN** the columns are ordered so each container's members are adjacent, following order of first mention, and each container is drawn with a single header

#### Scenario: GroupingDoesNotRestyleWhatItGroups
- **WHEN** the same document is rendered with and without its containers declared
- **THEN** the elements and relationships are drawn the same way in both, and only the container geometry differs

#### Scenario: TextualEquivalentCarriesMembership
- **WHEN** the textual equivalent of a document declaring containers is produced
- **THEN** it names each container and states which one each element or participant belongs to

### Requirement: DerivedDiagramExport

The system SHALL offer a diagram-syntax representation of a validated graph or sequence, derived
deterministically from the validated data, and SHALL label it as derived. The export SHALL carry the
same elements, relationships or messages, directions, and order as the data it was derived from.

The system SHALL NOT parse diagram syntax to create, repair, or augment authoritative data.

#### Scenario: ExportCarriesTheSameStructure
- **WHEN** a diagram export is derived from a validated graph
- **THEN** it contains exactly the same elements and directed relationships as that graph

#### Scenario: ExportIsDeterministic
- **WHEN** a diagram export is derived twice from the same validated data
- **THEN** both derivations are identical

#### Scenario: DiagramSyntaxIsNeverAnInput
- **WHEN** diagram syntax is present in or alongside a result
- **THEN** it is not parsed to produce, complete, or correct any structured data

### Requirement: RawOutputRemainsAvailable

Every structured presentation SHALL retain the tool's original input and complete original output and
keep them reachable. A rendering or a derived export SHALL NOT replace them.

An envelope that cannot be used — an unsupported version, an unsupported kind, or any validation
failure — SHALL leave the result readable as ordinary output.

#### Scenario: OriginalOutputStaysReachable
- **WHEN** a reader opens a structured presentation
- **THEN** the original tool input and output remain reachable

#### Scenario: UnsupportedVersionFallsBack
- **WHEN** a well-formed envelope declares a schema version the application does not support
- **THEN** no specialized presentation is attempted and the result stays readable as ordinary output

### Requirement: TableRowsMayDeclareAChangeRole

A row of a table MAY declare the role it plays in the change the table projects: `added`, `changed`,
`context`, or `removed`. A row that declares no role SHALL read as `context` when any row of the same
table declares one, and as an ordinary row of data when none does — so a table that declares no role
anywhere SHALL be rendered exactly as it was before roles existed.

The rendering SHALL present each declared role distinguishably, and SHALL present a given role the
same way it is presented elsewhere in the application: a reader who has learnt what an addition looks
like in a graph SHALL recognise an added row without learning a second vocabulary. A removed row
SHALL be shown as struck through as well as tinted, so the distinction does not rest on colour alone.
A rendering carrying roles SHALL provide a key naming every role it shows. A table is rendered as text
rather than as a figure and is not exported as one, so the key SHALL be carried by the rendering
itself and by its accessible textual equivalent.

The colouring SHALL be derived only from the declared role. The system SHALL NOT infer a role from a
cell's value, from a column's name, or from any accompanying text — a producer's own "status" column
is data, and SHALL be rendered as data.

A declared role SHALL NOT be an instruction: it states what the producer observed in the authority it
projected, and nothing in this application SHALL act on it.

#### Scenario: DeclaredRolesAreVisiblyDistinct
- **WHEN** a table declares rows with the roles `added`, `changed`, `context` and `removed`
- **THEN** each is presented distinguishably from the others, and a removed row is struck through as well as tinted

#### Scenario: RolesReadTheSameWayAcrossKinds
- **WHEN** an added row and an added element are presented in the same session
- **THEN** they are marked as additions in the same way

#### Scenario: ARowWithoutARoleIsContextAmongRolesThatExist
- **WHEN** a table declares roles on some rows and not on others
- **THEN** a row without a declared role is presented as context, not as an addition

#### Scenario: ATableWithoutRolesIsUnchanged
- **WHEN** a table declares no role on any row
- **THEN** it is rendered as an ordinary table, with no role colouring and no key

#### Scenario: TheKeyNamesEveryRoleShown
- **WHEN** a table carrying roles is rendered
- **THEN** a key names every role present, and the textual equivalent names the same roles the same way

#### Scenario: StatusDataIsNotARole
- **WHEN** a table carries a column whose values are `added`, `removed` or similar, and no row declares a role
- **THEN** those values are rendered as data and no row is coloured as a change

#### Scenario: AnUnknownRoleIsRejected
- **WHEN** a row declares a role outside the defined set
- **THEN** the envelope is rejected and no specialized presentation is produced

#### Scenario: ARowObjectStillAlignsToItsColumns
- **WHEN** a row declaring a role carries more or fewer cells than the table declares columns
- **THEN** it is rejected, naming the row, the count of cells and the count of columns

### Requirement: ATableLeavesAsData

A graph and a sequence leave this application as a figure. A table SHALL leave it as
data: the reader SHALL be able to take the table away as a comma-separated file and
as a spreadsheet workbook, in a form a spreadsheet application opens without
repair.

An export SHALL carry what the reader is looking at: the declared columns in their
declared order, every row currently shown, and each cell's declared value — a
number as a number, an empty cell where the document declares null. Where rows
declare roles, the export SHALL carry each row's role as a column of its own, since
the colour that states it in the rendering cannot survive the crossing.

Where a rendering is narrowed, its export SHALL carry only the rows shown, and the
application SHALL say so at the moment of export rather than letting a reader
believe they took the whole table away.

#### Scenario: ATableIsTakenAwayAsCommaSeparatedValues
- **WHEN** a reader exports a table as comma-separated values
- **THEN** the file carries the declared columns and every shown row, with values that contain a separator, a quote or a newline quoted so the file parses back to what was displayed

#### Scenario: ATableIsTakenAwayAsAWorkbook
- **WHEN** a reader exports a table as a spreadsheet workbook
- **THEN** a spreadsheet application opens it without repair, with one sheet whose header row names the declared columns

#### Scenario: TheExportCarriesTheRolesTheColourCarried
- **WHEN** a table whose rows declare roles is exported in either form
- **THEN** each row's role travels as a value, using the same words the key displays

#### Scenario: ANarrowedTableExportsWhatItShows
- **WHEN** a reader hides a role and then exports the table
- **THEN** the export contains only the rows still shown, and the application states that the export is narrowed

#### Scenario: APlainTableExportsWithoutARoleColumn
- **WHEN** a table that declares no role is exported
- **THEN** the export carries exactly the declared columns, with no column the document did not declare

### Requirement: AFigureLeavesAsOneFile

The system SHALL be able to export a rendered graph or sequence as a figure that is complete on its
own: it SHALL carry its own geometry, text and colour, and SHALL depend on no stylesheet, script,
font file or network resource of the application that produced it.

A figure SHALL contain no control the reader cannot use — nothing that exists only to support
pointing, dragging, hovering or selecting inside the application.

A figure SHALL show exactly what the rendering it was taken from shows. Where that rendering is
narrowed, the figure SHALL be narrowed identically and SHALL carry the statement
`ReaderMayAdjustAndNarrowTheView` requires of it, so that a figure separated from its document still
says how much of that document it shows.

#### Scenario: TheFigureStandsAlone
- **WHEN** a figure is exported and opened outside the application
- **THEN** it draws the same picture, with no reference to any resource of the application

#### Scenario: InteractionAffordancesDoNotTravel
- **WHEN** a figure is exported from a rendering that supports pointing and dragging
- **THEN** nothing that exists only for those interactions is present in the figure

#### Scenario: ANarrowedFigureSaysSo
- **GIVEN** a rendering narrowed to a subset of kinds
- **WHEN** it is exported
- **THEN** the figure shows exactly that subset and states how much of the document it is showing

### Requirement: AFigureCanBeProducedWithoutABrowser

The system SHALL be able to produce a figure from a validated document and a narrowing without a
browser, a display, or a running interface.

A figure so produced SHALL be the same figure the interactive rendering exports for the same
document and the same narrowing. "The same" means the same elements, relationships, messages,
containers, directions, order, labels, colours and geometry; it does not require the two byte
streams to be identical.

Production SHALL be deterministic: the same document and the same narrowing SHALL yield the same
figure every time.

A document that fails validation SHALL NOT yield a figure. The failure SHALL be reported with the
reason, as validation failures are reported elsewhere, and SHALL NOT produce an empty or partial
figure.

#### Scenario: TheSamePictureWithoutADisplay
- **GIVEN** a validated document and a narrowing
- **WHEN** a figure is produced with no browser present
- **THEN** it carries the same elements, relationships, order, labels and colours as the figure the interactive rendering exports for that document and that narrowing

#### Scenario: ProducingAFigureIsDeterministic
- **WHEN** a figure is produced twice from the same document and the same narrowing
- **THEN** both figures draw the same picture

#### Scenario: AnInvalidDocumentYieldsNoFigure
- **WHEN** a figure is requested for a document that fails validation
- **THEN** the request fails, names the reason, and writes nothing

### Requirement: TheAgentCanWriteAFigureToAPath

The system SHALL offer the agent a way to write a figure for a validated document to a path, so that
the agent can reference that figure from a document it is writing.

The request SHALL carry the document, the narrowing to apply, and the path to write. The narrowing
SHALL be expressed in the same terms a reader narrows by — hidden kinds, with element and
relationship vocabularies independent of each other — and an empty narrowing SHALL mean the whole
document, as it does for a reader.

Writing SHALL be confined exactly as every other agent write is confined: a path outside the
writable zone SHALL be refused, and refusal SHALL name the confinement rather than the underlying
filesystem error.

The result SHALL tell the agent what was written and how much of the document it shows, so that a
narrowing which selected nothing is visible as such rather than delivered as an empty picture.

#### Scenario: AFigureIsWrittenWhereTheAgentAsked
- **WHEN** the agent requests a figure for a validated document at a path inside the writable zone
- **THEN** the file is written at that path and contains that figure

#### Scenario: TheNarrowingIsTheReadersNarrowing
- **GIVEN** an element kind and a relationship kind that share a name
- **WHEN** the agent hides one of them
- **THEN** only the one named is hidden, exactly as it would be for a reader

#### Scenario: NoNarrowingMeansTheWholeDocument
- **WHEN** the agent requests a figure and names no hidden kind
- **THEN** every element and relationship of the document is drawn

#### Scenario: WritingOutsideTheWritableZoneIsRefused
- **WHEN** the agent requests a figure at a path outside the writable zone
- **THEN** the request is refused, the refusal names the confinement, and nothing is written

#### Scenario: TheResultSaysHowMuchItShows
- **WHEN** a figure is written from a narrowed document
- **THEN** the result states how much of the document the figure shows

#### Scenario: ANarrowingThatHidesEverythingIsReportedNotDrawn
- **WHEN** a narrowing leaves no element to draw
- **THEN** the result says so rather than reporting an empty figure as a success
