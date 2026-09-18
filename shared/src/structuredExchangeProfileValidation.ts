/**
 * Validating a profile and a registry — the files themselves, before any document
 * is held to them.
 *
 * A profile is written outside this application, by an export or by an agent, and a
 * profile that is quietly wrong is worse than none: every document held to it is
 * judged by a model nobody meant. So the same discipline as a document applies —
 * the committed schema first, then the rules a schema cannot state, each naming a
 * rule and pointing at the value — and nothing is corrected.
 *
 * Node-only, like the document schema check: it carries the compiler. The browser
 * never validates a profile; it is shown the server's verdict.
 */
import { RESERVED_PROFILE_IDENTIFIERS } from "./structuredExchangeProfile.ts";
import { Compile } from "typebox/compile";
import profileSchemaModule from "../schemas/structured-exchange-profile-1.json" with { type: "json" };
import registrySchemaModule from "../schemas/structured-exchange-profile-registry-1.json" with { type: "json" };
import type { StructuredViewpoint } from "./structuredExchange.ts";
import type { StructuredExchangeProfile, StructuredExchangeProfileRegistry } from "./structuredExchangeProfile.ts";
import { unwrapSchemaModule } from "./structuredExchangeSchemaNode.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

export type ProfileVerdict =
  | { valid: true; profile: StructuredExchangeProfile; issues: [] }
  | { valid: false; issues: StructuredExchangeIssue[] };

export type RegistryVerdict =
  | { valid: true; registry: StructuredExchangeProfileRegistry; issues: [] }
  | { valid: false; issues: StructuredExchangeIssue[] };

/** A registered profile file, read and validated, in the registry's order. */
export interface LoadedProfile {
  /** The path exactly as the registry lists it. */
  path: string;
  profile: StructuredExchangeProfile;
}

let profileCheck: ReturnType<typeof Compile> | undefined;
let registryCheck: ReturnType<typeof Compile> | undefined;

/** One JSON Pointer segment, escaped as RFC 6901 requires. */
function segment(name: string): string {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * The schema's complaints, as issues under a namespace of their own.
 *
 * `additionalProperties` is reported by TypeBox at the object that has the extra
 * field, with the field's name in its parameters. Pointed at the object, the author
 * of a forty-kind profile is told "somewhere in here"; pointed at the field, they
 * are told which word to delete.
 */
export function schemaIssues(check: ReturnType<typeof Compile>, value: unknown, namespace: string): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  for (const error of check.Errors(value)) {
    const keyword = String(error.keyword ?? "schema");
    const params = (error.params ?? {}) as { limit?: number; additionalProperties?: string[]; allowedValue?: unknown };
    const where = error.instancePath ?? "";
    const rule = `${namespace}/schema/${keyword}`;
    if (keyword === "additionalProperties" && Array.isArray(params.additionalProperties)) {
      for (const name of params.additionalProperties) {
        issues.push({ rule, path: `${where}/${segment(name)}`, message: `"${name}" is not a field this format defines` });
      }
      continue;
    }
    const message =
      keyword === "const" && params.allowedValue !== undefined
        ? `must be ${JSON.stringify(params.allowedValue)}`
        : (error.message ?? "does not conform to the published schema");
    issues.push({
      rule,
      path: where,
      message,
      ...(params.limit !== undefined ? { limit: params.limit, level: "ceiling" as const } : {}),
    });
  }
  // Deepest first, as for documents: the most specific complaint names the value.
  return issues.sort((left, right) => right.path.split("/").length - left.path.split("/").length);
}

/** The rules of a profile no schema states. Runs only on a profile the schema accepted. */
function profileRuleIssues(profile: StructuredExchangeProfile): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  const declared = { elementKinds: new Set<string>(), relationshipKinds: new Set<string>() };

  for (const list of ["elementKinds", "relationshipKinds"] as const) {
    const seenKinds = new Map<string, number>();
    (profile[list] ?? []).forEach((declaration, k) => {
      const at = `/${list}/${k}`;
      declared[list].add(declaration.kind);
      const firstKind = seenKinds.get(declaration.kind);
      if (firstKind === undefined) seenKinds.set(declaration.kind, k);
      else {
        issues.push({
          rule: "profile-format/duplicate-kind",
          path: `${at}/kind`,
          message: `kind "${declaration.kind}" is already declared at /${list}/${firstKind}; declare each kind once, with all its attributes`,
        });
      }

      const seenAttributes = new Map<string, number>();
      (declaration.attributes ?? []).forEach((attribute, a) => {
        const attributeAt = `${at}/attributes/${a}`;
        const firstAttribute = seenAttributes.get(attribute.name);
        if (firstAttribute === undefined) seenAttributes.set(attribute.name, a);
        else {
          issues.push({
            rule: "profile-format/duplicate-attribute",
            path: `${attributeAt}/name`,
            message: `kind "${declaration.kind}" already declares attribute "${attribute.name}" at ${at}/attributes/${firstAttribute}`,
          });
        }

        if (attribute.type === "enumeration") {
          const missing = [
            attribute.values === undefined ? "its values" : undefined,
            attribute.closed === undefined ? "whether it is closed" : undefined,
          ].filter((part): part is string => part !== undefined);
          if (missing.length > 0) {
            issues.push({
              rule: "profile-format/incomplete-enumeration",
              path: attributeAt,
              message: `enumeration "${attribute.name}" of kind "${declaration.kind}" does not declare ${missing.join(" or ")}`,
            });
          }
          const seenValues = new Map<string, number>();
          (attribute.values ?? []).forEach((value, v) => {
            const firstValue = seenValues.get(value);
            if (firstValue === undefined) seenValues.set(value, v);
            else {
              issues.push({
                rule: "profile-format/repeated-enumeration-value",
                path: `${attributeAt}/values/${v}`,
                message: `value "${value}" is already listed at ${attributeAt}/values/${firstValue}`,
              });
            }
          });
        } else {
          for (const field of ["values", "closed"] as const) {
            if (attribute[field] === undefined) continue;
            issues.push({
              rule: "profile-format/values-on-non-enumeration",
              path: `${attributeAt}/${field}`,
              message: `attribute "${attribute.name}" is a ${attribute.type}, and only an enumeration declares ${field}`,
            });
          }
        }
      });
    });
  }

  // A relationship kind's ends name element kinds. One this profile does not declare
  // would refuse every relationship of the kind, which reads as a strict model and is a
  // typo; one named twice is harmless but says the list was not read.
  const declaredElementKinds = [...declared.elementKinds].map((kind) => `"${kind}"`).join(", ") || "none";
  (profile.relationshipKinds ?? []).forEach((declaration, k) => {
    for (const end of ["from", "to"] as const) {
      const seen = new Map<string, number>();
      declaration[end]?.forEach((kind, position) => {
        const at = `/relationshipKinds/${k}/${end}/${position}`;
        const first = seen.get(kind);
        if (first !== undefined) {
          issues.push({
            rule: "profile-format/repeated-end-kind",
            path: at,
            message: `relationship kind "${declaration.kind}" already names "${kind}" at /relationshipKinds/${k}/${end}/${first}`,
          });
          return;
        }
        seen.set(kind, position);
        if (declared.elementKinds.has(kind)) return;
        issues.push({
          rule: "profile-format/unresolved-end-kind",
          path: at,
          message:
            `relationship kind "${declaration.kind}" allows element kind "${kind}" at its ${end === "from" ? "source" : "target"}, which this profile does not declare; it declares ${declaredElementKinds}` +
            (declared.relationshipKinds.has(kind) ? ` ("${kind}" is a relationship kind here, and a relationship joins elements)` : ""),
        });
      });
    }
  });

  const seenViewpoints = new Map<string, number>();
  (profile.viewpoints ?? []).forEach((viewpoint: StructuredViewpoint, index) => {
    const at = `/viewpoints/${index}`;
    const first = seenViewpoints.get(viewpoint.id);
    if (first === undefined) seenViewpoints.set(viewpoint.id, index);
    else {
      issues.push({
        rule: "profile-format/duplicate-viewpoint-identifier",
        path: `${at}/id`,
        message: `viewpoint "${viewpoint.id}" is already declared at /viewpoints/${first}`,
      });
    }
    if (viewpoint.elementKinds === undefined && viewpoint.relationshipKinds === undefined) {
      issues.push({
        rule: "profile-format/empty-viewpoint",
        path: at,
        message: `viewpoint "${viewpoint.id}" retains no kind; name elementKinds, relationshipKinds, or both`,
      });
    }
    const checks = [
      ["elementKinds", "relationshipKinds", "element", "relationship"],
      ["relationshipKinds", "elementKinds", "relationship", "element"],
    ] as const;
    for (const [list, otherList, noun, otherNoun] of checks) {
      viewpoint[list]?.forEach((kind, position) => {
        if (declared[list].has(kind)) return;
        issues.push({
          rule: "profile-format/unresolved-viewpoint-kind",
          path: `${at}/${list}/${position}`,
          message:
            `viewpoint "${viewpoint.id}" retains ${noun} kind "${kind}", which this profile does not declare` +
            (declared[otherList].has(kind) ? ` (it is a ${otherNoun} kind here, which is a different vocabulary)` : ""),
        });
      });
    }
  });

  return issues;
}

/** A profile file's content, judged as the format defines it. */
export function validateProfile(value: unknown): ProfileVerdict {
  profileCheck ??= Compile(unwrapSchemaModule(profileSchemaModule));
  const schema = schemaIssues(profileCheck, value, "profile-format");
  if (schema.length > 0) return { valid: false, issues: schema };
  const profile = value as StructuredExchangeProfile;
  // A profile claiming a reserved identifier would turn the contract's exemption into a
  // project's rule, and a report held to it would be refused for what it reports on.
  const reserved: StructuredExchangeIssue[] = RESERVED_PROFILE_IDENTIFIERS.has(profile.id)
    ? [{ rule: "profile-format/reserved-identifier", path: "/id", message: '"' + profile.id + '" is reserved by the structured-exchange contract: a document naming it is never held to a profile' }]
    : [];
  const rules = [...reserved, ...profileRuleIssues(profile)];
  return rules.length > 0 ? { valid: false, issues: rules } : { valid: true, profile, issues: [] };
}

/** A registry file's content, on its own — before the profiles it lists are read. */
export function validateRegistry(value: unknown): RegistryVerdict {
  registryCheck ??= Compile(unwrapSchemaModule(registrySchemaModule));
  const schema = schemaIssues(registryCheck, value, "registry");
  if (schema.length > 0) return { valid: false, issues: schema };
  const registry = value as StructuredExchangeProfileRegistry;
  const issues: StructuredExchangeIssue[] = [];
  const seenPaths = new Map<string, number>();
  registry.profiles.forEach((listed, index) => {
    const first = seenPaths.get(listed);
    if (first === undefined) seenPaths.set(listed, index);
    else issues.push({ rule: "registry/repeated-profile-path", path: `/profiles/${index}`, message: `"${listed}" is already listed at /profiles/${first}` });
  });
  return issues.length > 0 ? { valid: false, issues } : { valid: true, registry, issues: [] };
}

/**
 * What only the registry and its profiles together can get wrong: two files claiming
 * one identifier, and a default nothing registers.
 *
 * `loaded` is in the registry's order, one entry per listed path, so a pointer into
 * the registry names the entry at fault.
 */
export function registryConsistencyIssues(
  registry: StructuredExchangeProfileRegistry,
  loaded: readonly LoadedProfile[],
): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  const firstById = new Map<string, number>();
  loaded.forEach((entry, index) => {
    const first = firstById.get(entry.profile.id);
    if (first === undefined) firstById.set(entry.profile.id, index);
    else {
      issues.push({
        rule: "registry/duplicate-profile-identifier",
        path: `/profiles/${index}`,
        message: `"${entry.path}" declares profile "${entry.profile.id}", which "${loaded[first].path}" already declares`,
      });
    }
  });
  if (registry.default !== undefined && !firstById.has(registry.default)) {
    const registered = [...firstById.keys()].map((id) => `"${id}"`).join(", ");
    issues.push({
      rule: "registry/unregistered-default",
      path: "/default",
      message: `default "${registry.default}" is not the identifier of any registered profile; registered: ${registered}`,
    });
  }
  return issues;
}
