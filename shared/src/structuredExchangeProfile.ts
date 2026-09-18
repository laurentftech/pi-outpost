/**
 * Structured-exchange profiles: a project's data model, held against the documents
 * the agent produces for it.
 *
 * The core contract treats a document's `profile` as an opaque name, and says so. A
 * project that registers profiles is the "receiving authority" that contract leaves
 * room for: it declares the kinds, attributes and enumeration values its model has,
 * and the agent's tools refuse a document that strays from them. Nothing here is
 * ever fetched — a registry and its profiles are files in the project, and a
 * profile is found by exact identifier.
 *
 * Kinds and attributes are arrays, not maps keyed by name. `JSON.parse` keeps the
 * last of two equal keys and says nothing, and reorders keys that look like
 * integers: a profile built by an agent that declared `status` twice would lose one
 * silently, which is the incompleteness this format exists to catch.
 */
import type { StructuredViewpoint } from "./structuredExchange.ts";

export const STRUCTURED_EXCHANGE_PROFILE_SCHEMA_V1 = "urn:structured-exchange-profile:1";
export const STRUCTURED_EXCHANGE_PROFILE_REGISTRY_SCHEMA_V1 = "urn:structured-exchange-profile-registry:1";

/** Where a project keeps its registry, relative to the project directory. */
export const STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH = ".pi-outpost/structured-exchange.json";

/**
 * The profile a conformity report names. Reserved: it says what the document is — a
 * verdict on requirements, not requirements — so no project's profile holds it, and no
 * profile may claim it. Held to a project's default, a report would be refused for
 * lacking the very attributes it reports on.
 */
export const STRUCTURED_EXCHANGE_CONFORMITY_REPORT_PROFILE = "urn:structured-exchange-conformity-report:1";

/**
 * The profiles a rules register and rule patterns name. Reserved for the same reason as a
 * report's: they describe a project's model rather than being things of it, and a view of
 * the rules held to the default profile would be refused for not being a requirement.
 */
export const STRUCTURED_EXCHANGE_RULES_REGISTER_PROFILE = "urn:structured-exchange-rules-register:1";
export const STRUCTURED_EXCHANGE_RULE_PATTERNS_PROFILE = "urn:structured-exchange-rule-patterns:1";

/** Profile identifiers the contract reserves; a document naming one is never held to a project's profile. */
export const RESERVED_PROFILE_IDENTIFIERS: ReadonlySet<string> = new Set([
  STRUCTURED_EXCHANGE_CONFORMITY_REPORT_PROFILE,
  STRUCTURED_EXCHANGE_RULES_REGISTER_PROFILE,
  STRUCTURED_EXCHANGE_RULE_PATTERNS_PROFILE,
]);

/**
 * The bounds of a profile and of a registry.
 *
 * Magnitudes are borrowed from the document contract wherever one fits: a profile
 * cannot usefully declare more kinds than a document's vocabulary can hold apart,
 * more attributes per kind than an item may carry, or an enumeration value longer
 * than an attribute string. The new numbers are the ones the document contract had
 * no word for.
 */
export const STRUCTURED_EXCHANGE_PROFILE_CEILINGS = {
  /** A profile's identifier, bounded like the `profile` a document names it by. */
  id: 200,
  label: 500,
  description: 2000,
  /** Kinds per vocabulary, as a document's `kindsPerVocabulary`. */
  kindsPerVocabulary: 64,
  /** Attributes one kind declares, as a document's `attributesPerItem`. */
  attributesPerKind: 50,
  attributeName: 200,
  /**
   * Values one enumeration lists. Generous: a requirements tool's enumerations
   * include long ones — components, suppliers — and a profile that cannot hold its
   * model's is a profile nobody can finish.
   */
  enumerationValues: 500,
  /** One enumeration value, as a document's `attributeString`. */
  enumerationValue: 1000,
  viewpoints: 20,
  /** Profiles one registry lists. */
  profilesPerRegistry: 20,
  profilePath: 500,
  /** Bytes read from a profile file before it is parsed. */
  profileBytes: 1_048_576,
  /** Bytes read from a registry file before it is parsed. */
  registryBytes: 65_536,
} as const;

export type ProfileAttributeType = "string" | "number" | "boolean" | "reference" | "enumeration";

export interface ProfileAttribute {
  name: string;
  type: ProfileAttributeType;
  required?: boolean;
  list?: boolean;
  description?: string;
  /** An enumeration's values; no other type carries them. */
  values?: string[];
  /** An enumeration's: true refuses a value outside `values`, false reports it. */
  closed?: boolean;
}

export interface ProfileKind {
  kind: string;
  description?: string;
  attributes?: ProfileAttribute[];
}

/**
 * A relationship kind, and the element kinds it may join. A side left undeclared allows
 * any element kind: a profile written before ends existed keeps its meaning.
 */
export interface ProfileRelationshipKind extends ProfileKind {
  /** The element kinds allowed at the source. */
  from?: string[];
  /** The element kinds allowed at the target. */
  to?: string[];
}

export interface StructuredExchangeProfile {
  schema: typeof STRUCTURED_EXCHANGE_PROFILE_SCHEMA_V1;
  id: string;
  label: string;
  description?: string;
  /** Govern graph elements and table rows. */
  elementKinds?: ProfileKind[];
  /** Govern graph relationships and table relations. */
  relationshipKinds?: ProfileRelationshipKind[];
  viewpoints?: StructuredViewpoint[];
}

/**
 * What a reader is told about a presented document and its project's profile.
 *
 * Established against the registry as it is when the document is shown, so a replay
 * after the profile changed says so. Carried beside the document, never in it: the
 * document handed on for approval stays the one that was validated.
 */
export interface StructuredConformance {
  /** The profile it was checked against; absent when the registry could not say. */
  profile?: string;
  /** `unchecked`: the project's registry cannot be used right now. */
  state: "conforms" | "strays" | "unchecked";
  /** Values outside open enumerations, accepted and counted. */
  openValues: number;
  /**
   * What the profile's rules leave to check — violated report rules and rules not
   * verifiable here. Absent when there are none.
   */
  findings?: number;
}

/**
 * A profile as plain text, for the review no machine can do.
 *
 * Whoever built the profile — from a requirements tool's export, or by asking an
 * agent — has to compare it with the model it came from, and the enumerations above
 * all. So this elides nothing and reorders nothing: every kind, every attribute with
 * its type and whether it is required or a list, every enumeration value on its own
 * line under whether the enumeration is closed or open, in the author's order.
 */
export function profileListing(profile: StructuredExchangeProfile): string {
  const lines: string[] = [`Profile ${profile.id} — ${profile.label}`];
  if (profile.description !== undefined) lines.push(profile.description);

  const vocabulary = (heading: string, kinds: readonly ProfileRelationshipKind[] | undefined, relationships: boolean) => {
    const declared = kinds ?? [];
    lines.push("", `${heading}: ${declared.length}`);
    for (const declaration of declared) {
      lines.push(`  ${declaration.kind}`);
      if (declaration.description !== undefined) lines.push(`    ${declaration.description}`);
      // Said for every relationship kind, declared or not: "any element kind" is a
      // property of the model a reviewer should see, not an absence to infer.
      if (relationships) {
        lines.push(`    source: ${declaration.from?.join(", ") ?? "any element kind"}`);
        lines.push(`    target: ${declaration.to?.join(", ") ?? "any element kind"}`);
      }
      const attributes = declaration.attributes ?? [];
      if (attributes.length === 0) lines.push("    (no attributes)");
      for (const attribute of attributes) {
        const traits = [
          attribute.list === true ? `list of ${attribute.type}` : attribute.type,
          ...(attribute.type === "enumeration" ? [attribute.closed === true ? "closed" : "open"] : []),
          attribute.required === true ? "required" : "optional",
        ];
        const count = attribute.type === "enumeration" ? ` — ${(attribute.values ?? []).length} values` : "";
        lines.push(`    ${attribute.name}: ${traits.join(", ")}${count}`);
        if (attribute.description !== undefined) lines.push(`      ${attribute.description}`);
        for (const value of attribute.values ?? []) lines.push(`      - ${value}`);
      }
    }
  };
  vocabulary("Element kinds (graph elements and table rows)", profile.elementKinds, false);
  vocabulary("Relationship kinds (graph relationships and table relations)", profile.relationshipKinds, true);

  const viewpoints = profile.viewpoints ?? [];
  lines.push("", `Viewpoints: ${viewpoints.length}`);
  for (const viewpoint of viewpoints) {
    lines.push(`  ${viewpoint.id} — ${viewpoint.label}: ${viewpoint.concern}`);
    if (viewpoint.elementKinds !== undefined) lines.push(`    element kinds: ${viewpoint.elementKinds.join(", ")}`);
    if (viewpoint.relationshipKinds !== undefined) lines.push(`    relationship kinds: ${viewpoint.relationshipKinds.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

export interface StructuredExchangeProfileRegistry {
  schema: typeof STRUCTURED_EXCHANGE_PROFILE_REGISTRY_SCHEMA_V1;
  /** Profile files, relative to the project directory. */
  profiles: string[];
  /** Rules files, relative to the project directory; each names the profile it applies to. */
  rules?: string[];
  /** A registered profile's identifier. */
  default?: string;
}

/**
 * A set of conditions as it is checked: each attribute with the values any one of which it
 * accepts, all of them holding together. The listing and the rules register read the same
 * way because they both read this.
 */
export function describeConditions(set: RuleConditions | undefined): string {
  return (
    Object.entries(set ?? {})
      .map(([name, values]) => `${name} ∈ {${values.map((value) => JSON.stringify(value)).join(", ")}}`)
      .join(" and ") || "always"
  );
}

/** A link rule's conditions, labelled by the end they are read on. */
export function describeLinkConditions(set: LinkConditions | undefined): string {
  const parts = [
    set?.from === undefined ? undefined : `source ${describeConditions(set.from)}`,
    set?.to === undefined ? undefined : `target ${describeConditions(set.to)}`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? "always" : parts.join(" and ");
}

/**
 * A profile's rules as plain text, each statement beside what it checks.
 *
 * A rule is only as good as the match between the sentence a reviewer approved and the
 * conditions the machine applies; this is the page on which the two can be compared.
 * Nothing is elided and nothing reordered.
 */
export function rulesListing(profileId: string, rules: readonly ProfileRule[]): string {
  const conditions = describeConditions;
  const ends = describeLinkConditions;
  const lines: string[] = [`Rules for ${profileId}: ${rules.length}`];
  for (const rule of rules) {
    lines.push("", `  ${rule.id} — ${rule.level}${rule.source === undefined ? "" : ` — ${rule.source}`}`, `    ${rule.statement}`);
    if (rule.element !== undefined) {
      lines.push(`    applies to: element ${rule.element}`, `    when: ${conditions(rule.when)}`);
      lines.push(`    then: ${rule.then === "forbidden" ? "forbidden" : conditions(rule.then)}`);
    } else {
      lines.push(`    applies to: relationship ${rule.relationship}`, `    when: ${ends(rule.when)}`);
      lines.push(`    then: ${rule.then === "forbidden" ? "forbidden" : ends(rule.then)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export const STRUCTURED_EXCHANGE_RULES_SCHEMA_V1 = "urn:structured-exchange-rules:1";

/**
 * The bounds of a rules file.
 *
 * Borrowed where a magnitude already exists: a value is bounded like an enumeration
 * value, a list of values like an enumeration, an attribute name like one. Rules per
 * file is generous for human-written rules — a file past it is a vocabulary written as
 * rules, not a set of review rules.
 */
export const STRUCTURED_EXCHANGE_RULES_CEILINGS = {
  rulesPerFile: 200,
  ruleId: 200,
  statement: 2000,
  source: 500,
  /** Conditions in one set — `when`, `then`, or one end of a link. */
  conditionsPerSet: 20,
  /** Values one condition allows, as `enumerationValues`. */
  valuesPerCondition: 500,
  /** One value, as `enumerationValue`. */
  value: 1000,
  attributeName: 200,
  kind: 100,
  /** Rules files one registry lists. */
  rulesFilesPerRegistry: 20,
  /** Bytes read from a rules file before it is parsed. */
  rulesBytes: 1_048_576,
} as const;

export type RuleValue = string | number | boolean;

/** Attribute name to the values it may take; every condition of a set must hold. */
export type RuleConditions = Record<string, RuleValue[]>;

export type RuleLevel = "refuse" | "report";

interface RuleCommon {
  id: string;
  statement: string;
  source?: string;
  level: RuleLevel;
}

/** A rule on items of one element kind. */
export interface ItemRule extends RuleCommon {
  element: string;
  relationship?: never;
  when?: RuleConditions;
  then: RuleConditions | "forbidden";
}

/** Conditions on a relationship's source and target. */
export interface LinkConditions {
  from?: RuleConditions;
  to?: RuleConditions;
}

/** A rule on relationships of one kind, conditioned by the attributes at either end. */
export interface LinkRule extends RuleCommon {
  relationship: string;
  element?: never;
  when?: LinkConditions;
  then: LinkConditions | "forbidden";
}

export type ProfileRule = ItemRule | LinkRule;

export interface StructuredExchangeRules {
  schema: typeof STRUCTURED_EXCHANGE_RULES_SCHEMA_V1;
  /** The registered profile these rules apply to. */
  profile: string;
  rules: ProfileRule[];
}
