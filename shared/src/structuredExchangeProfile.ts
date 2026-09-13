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

export interface StructuredExchangeProfile {
  schema: typeof STRUCTURED_EXCHANGE_PROFILE_SCHEMA_V1;
  id: string;
  label: string;
  description?: string;
  /** Govern graph elements and table rows. */
  elementKinds?: ProfileKind[];
  /** Govern graph relationships and table relations. */
  relationshipKinds?: ProfileKind[];
  viewpoints?: StructuredViewpoint[];
}

export interface StructuredExchangeProfileRegistry {
  schema: typeof STRUCTURED_EXCHANGE_PROFILE_REGISTRY_SCHEMA_V1;
  /** Profile files, relative to the project directory. */
  profiles: string[];
  /** A registered profile's identifier. */
  default?: string;
}
