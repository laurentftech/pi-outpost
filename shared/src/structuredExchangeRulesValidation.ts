/**
 * Validating a rules file — on its own, against the profile it names, and beside the
 * other rules files of a registry.
 *
 * A rule people wrote in their own words is only worth the check that it can fire. A
 * rule naming `derivee` where the profile says `derived` would never match anything,
 * and a review would pass it while the rule silently checked nothing. So a rules file
 * is checked against the vocabulary it relies on every time it is read, and refused
 * with a pointer to the word that does not exist.
 *
 * Node-only, like profile validation: it carries the schema compiler.
 */
import { Compile } from "typebox/compile";
import rulesSchemaModule from "../schemas/structured-exchange-rules-1.json" with { type: "json" };
import type {
  LinkConditions,
  ProfileAttribute,
  ProfileRule,
  RuleConditions,
  StructuredExchangeProfile,
  StructuredExchangeRules,
} from "./structuredExchangeProfile.ts";
import { schemaIssues } from "./structuredExchangeProfileValidation.ts";
import { unwrapSchemaModule } from "./structuredExchangeSchemaNode.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";

export type RulesVerdict =
  | { valid: true; rules: StructuredExchangeRules; issues: [] }
  | { valid: false; issues: StructuredExchangeIssue[] };

/** A registered rules file, read and validated on its own, in the registry's order. */
export interface LoadedRules {
  /** The path exactly as the registry lists it. */
  path: string;
  rules: StructuredExchangeRules;
}

let rulesCheck: ReturnType<typeof Compile> | undefined;

const quoted = (values: readonly unknown[]): string => (values.length === 0 ? "none" : values.map((value) => JSON.stringify(value)).join(", "));

/** One JSON Pointer segment, escaped as RFC 6901 requires. */
function segment(name: string): string {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

const isConditionList = (value: unknown): boolean => Array.isArray(value);
const isConditionSet = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The form of each rule, which the schema leaves open so its refusals can be precise:
 * an item rule's conditions are attribute lists; a link rule's are `from` and `to`, each
 * a set of attribute lists.
 */
function formIssues(file: StructuredExchangeRules): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  const seen = new Map<string, number>();
  file.rules.forEach((rule, index) => {
    const at = `/rules/${index}`;
    const first = seen.get(rule.id);
    if (first === undefined) seen.set(rule.id, index);
    else {
      issues.push({ rule: "rules-format/duplicate-rule-identifier", path: `${at}/id`, message: `rule "${rule.id}" is already declared at /rules/${first}` });
    }

    const { element, relationship } = rule as { element?: string; relationship?: string };
    if ((element === undefined) === (relationship === undefined)) {
      issues.push({
        rule: "rules-format/rule-form",
        path: at,
        message: `rule "${rule.id}" must name exactly one of "element" (an item rule) or "relationship" (a link rule)`,
      });
      return;
    }

    const clauses: [string, unknown][] = [
      ["when", rule.when],
      ["then", rule.then],
    ];
    for (const [name, clause] of clauses) {
      if (clause === undefined || clause === "forbidden") continue;
      const clauseAt = `${at}/${name}`;
      if (!isConditionSet(clause)) continue; // the schema already refused it
      if (name === "then" && Object.keys(clause).length === 0) {
        issues.push({ rule: "rules-format/empty-then", path: clauseAt, message: `rule "${rule.id}" requires nothing; name conditions, or "forbidden"` });
        continue;
      }
      if (element !== undefined) {
        for (const [attribute, values] of Object.entries(clause)) {
          if (isConditionList(values)) continue;
          issues.push({
            rule: "rules-format/item-conditions",
            path: `${clauseAt}/${segment(attribute)}`,
            message: `rule "${rule.id}" is an item rule, so "${attribute}" must list the values it allows; "from" and "to" belong to link rules`,
          });
        }
      } else {
        for (const [end, conditions] of Object.entries(clause)) {
          const endAt = `${clauseAt}/${segment(end)}`;
          if (end !== "from" && end !== "to") {
            issues.push({
              rule: "rules-format/link-conditions",
              path: endAt,
              message: `rule "${rule.id}" is a link rule, so its conditions are on "from" (the source) or "to" (the target), not "${end}"`,
            });
            continue;
          }
          if (!isConditionSet(conditions)) {
            issues.push({ rule: "rules-format/link-conditions", path: endAt, message: `"${end}" must be a set of attribute conditions` });
            continue;
          }
          for (const [attribute, values] of Object.entries(conditions)) {
            if (isConditionList(values)) continue;
            issues.push({ rule: "rules-format/link-conditions", path: `${endAt}/${segment(attribute)}`, message: `"${attribute}" must list the values it allows` });
          }
        }
        if (name === "then" && Object.values(clause).every((conditions) => isConditionSet(conditions) && Object.keys(conditions).length === 0)) {
          issues.push({ rule: "rules-format/empty-then", path: clauseAt, message: `rule "${rule.id}" requires nothing; name conditions, or "forbidden"` });
        }
      }
    }
  });
  return issues;
}

/** A rules file's content, judged by the format alone — before the profile it names is known. */
export function validateRules(value: unknown): RulesVerdict {
  rulesCheck ??= Compile(unwrapSchemaModule(rulesSchemaModule));
  const schema = schemaIssues(rulesCheck, value, "rules-format");
  if (schema.length > 0) return { valid: false, issues: schema };
  const file = value as StructuredExchangeRules;
  const form = formIssues(file);
  return form.length > 0 ? { valid: false, issues: form } : { valid: true, rules: file, issues: [] };
}

/** Whether `value` is one an attribute declared this way can carry. */
function acceptable(attribute: ProfileAttribute, value: unknown): boolean {
  if (attribute.type === "number") return typeof value === "number";
  if (attribute.type === "boolean") return typeof value === "boolean";
  if (attribute.type === "string") return typeof value === "string";
  if (attribute.type === "enumeration") return typeof value === "string" && (attribute.values ?? []).includes(value);
  return false;
}

/**
 * A rules file against the profile it names: every kind, attribute and value it uses has
 * to exist there, in the vocabulary the rule uses, with the type the profile declares.
 */
export function rulesAgainstProfile(file: StructuredExchangeRules, profile: StructuredExchangeProfile): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  const elementKinds = new Map((profile.elementKinds ?? []).map((declaration) => [declaration.kind, declaration]));
  const relationshipKinds = new Set((profile.relationshipKinds ?? []).map((declaration) => declaration.kind));

  /** Conditions on attributes of `kinds` (one kind for an item rule, any element kind for a link end). */
  const checkConditions = (rule: ProfileRule, conditions: RuleConditions | undefined, at: string, kinds: string[]) => {
    for (const [name, values] of Object.entries(conditions ?? {})) {
      const attributeAt = `${at}/${segment(name)}`;
      const declarations = kinds
        .map((kind) => (elementKinds.get(kind)?.attributes ?? []).find((attribute) => attribute.name === name))
        .filter((attribute): attribute is ProfileAttribute => attribute !== undefined);
      if (declarations.length === 0) {
        issues.push({
          rule: "rules-format/undeclared-attribute",
          path: attributeAt,
          message:
            kinds.length === 1
              ? `rule "${rule.id}" names attribute "${name}", which kind "${kinds[0]}" of profile "${profile.id}" does not declare`
              : `rule "${rule.id}" names attribute "${name}", which no element kind of profile "${profile.id}" declares`,
        });
        continue;
      }
      const unsupported = declarations.find((attribute) => attribute.list === true || attribute.type === "reference");
      if (unsupported !== undefined) {
        issues.push({
          rule: "rules-format/unsupported-attribute",
          path: attributeAt,
          message: `rule "${rule.id}" names attribute "${name}", which holds ${unsupported.list === true ? "a list" : "a reference"}; rules condition single string, number, boolean or enumeration values`,
        });
        continue;
      }
      values.forEach((value, position) => {
        if (declarations.some((attribute) => acceptable(attribute, value))) return;
        const enumeration = declarations.find((attribute) => attribute.type === "enumeration");
        issues.push({
          rule: enumeration !== undefined ? "rules-format/undeclared-value" : "rules-format/value-type",
          path: `${attributeAt}/${position}`,
          message:
            enumeration !== undefined
              ? `rule "${rule.id}" names ${JSON.stringify(value)} for "${name}", which profile "${profile.id}" does not list; it lists ${quoted(enumeration.values ?? [])}`
              : `rule "${rule.id}" names ${JSON.stringify(value)} for "${name}", which profile "${profile.id}" declares as ${declarations[0].type}`,
        });
      });
    }
  };

  file.rules.forEach((rule, index) => {
    const at = `/rules/${index}`;
    if (rule.element !== undefined) {
      if (!elementKinds.has(rule.element)) {
        issues.push({
          rule: "rules-format/undeclared-kind",
          path: `${at}/element`,
          message: `rule "${rule.id}" applies to element kind "${rule.element}", which profile "${profile.id}" does not declare; it declares ${quoted([...elementKinds.keys()])}`,
        });
        return;
      }
      checkConditions(rule, rule.when, `${at}/when`, [rule.element]);
      if (rule.then !== "forbidden") checkConditions(rule, rule.then, `${at}/then`, [rule.element]);
      return;
    }
    if (!relationshipKinds.has(rule.relationship)) {
      issues.push({
        rule: "rules-format/undeclared-kind",
        path: `${at}/relationship`,
        message: `rule "${rule.id}" applies to relationship kind "${rule.relationship}", which profile "${profile.id}" does not declare; it declares ${quoted([...relationshipKinds])}`,
      });
      return;
    }
    const anyElement = [...elementKinds.keys()];
    const clauses: [string, LinkConditions | "forbidden" | undefined][] = [
      ["when", rule.when],
      ["then", rule.then],
    ];
    for (const [name, clause] of clauses) {
      if (clause === undefined || clause === "forbidden") continue;
      checkConditions(rule, clause.from, `${at}/${name}/from`, anyElement);
      checkConditions(rule, clause.to, `${at}/${name}/to`, anyElement);
    }
  });
  return issues;
}

/**
 * What only the registry's rules files together can get wrong: a file for a profile
 * nothing registers, and one rule identifier claimed twice for a profile — which a
 * report could not tell apart.
 */
export function registryRulesIssues(
  loaded: readonly LoadedRules[],
  profiles: ReadonlyMap<string, StructuredExchangeProfile>,
): StructuredExchangeIssue[] {
  const issues: StructuredExchangeIssue[] = [];
  const firstRule = new Map<string, { path: string }>();
  loaded.forEach((entry, index) => {
    if (!profiles.has(entry.rules.profile)) {
      issues.push({
        rule: "registry/rules-for-unregistered-profile",
        path: `/rules/${index}`,
        message: `"${entry.path}" applies to profile "${entry.rules.profile}", which the registry does not register; registered: ${quoted([...profiles.keys()])}`,
      });
    }
    for (const rule of entry.rules.rules) {
      const key = `${entry.rules.profile} ${rule.id}`;
      const first = firstRule.get(key);
      if (first === undefined) firstRule.set(key, { path: entry.path });
      else if (first.path !== entry.path) {
        issues.push({
          rule: "registry/duplicate-rule-identifier",
          path: `/rules/${index}`,
          message: `"${entry.path}" declares rule "${rule.id}" for profile "${entry.rules.profile}", which "${first.path}" already declares`,
        });
      }
    }
  });
  return issues;
}
