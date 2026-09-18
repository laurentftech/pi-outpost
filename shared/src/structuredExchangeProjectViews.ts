/**
 * A project's model, shown back to the people who wrote it: the rules register and the
 * rule patterns of one registered profile.
 *
 * Both are generated from the profile and rules files alone, never drawn by a model, so a
 * reviewer confirms what the files say rather than what somebody made of them. The same
 * files give the same document, byte for byte — no date, no version — and the files' digests
 * say which version was reviewed.
 *
 * Each names a profile identifier the contract reserves: a view describes a model and is not
 * a thing of it, so a project's default profile never holds it.
 *
 * Node-only, like the conformity report: a view is checked against the committed schema
 * before it is handed out, and one that does not fit the contract is refused, not trimmed.
 */
import {
  STRUCTURED_EXCHANGE_RULE_PATTERNS_PROFILE,
  STRUCTURED_EXCHANGE_RULES_REGISTER_PROFILE,
  describeConditions,
  describeLinkConditions,
  type ProfileRule,
  type StructuredExchangeProfile,
} from "./structuredExchangeProfile.ts";
import { STRUCTURED_EXCHANGE_CEILINGS, STRUCTURED_EXCHANGE_SCHEMA_V2 } from "./structuredExchange.ts";
import { parseStructuredExchange } from "./structuredExchangeParse.ts";
import type { ProfileContext } from "./structuredExchangeProfileCheck.ts";
import { checkStructuredExchangeSchema } from "./structuredExchangeSchemaNode.ts";

/** A file a view was generated from, relative to the project, with its bytes' digest. */
export interface ViewSource {
  path: string;
  sha256: string;
}

export type ProjectView = { document: Record<string, unknown> } | { refused: string };

export type ViewProfileChoice = { profile: StructuredExchangeProfile } | { refused: string };

/** The kinds of a pattern's elements: what a reader tells an end or an item apart by. */
export const PATTERN_KINDS = {
  /** An end the rule selects on, and requires nothing of. */
  selects: "selects",
  /** An end the rule requires something of. */
  mustHold: "must hold",
  /** An end the rule says nothing about. */
  any: "any",
  selectedItem: "selected item",
  forbiddenItem: "forbidden item",
} as const;

const quoted = (values: readonly string[]): string => values.map((value) => `"${value}"`).join(", ");

/**
 * Which registered profile a view is of: the one named, else the default, else the only
 * one. Anything else is refused listing what is registered — a view of a guessed profile
 * would be reviewed as the project's.
 */
export function selectViewProfile(context: ProfileContext, named?: string): ViewProfileChoice {
  const registered = [...context.profiles.keys()];
  if (named !== undefined) {
    const profile = context.profiles.get(named);
    return profile === undefined
      ? { refused: `this project registers no profile "${named}"; registered: ${quoted(registered)}` }
      : { profile };
  }
  if (context.default !== undefined) {
    const profile = context.profiles.get(context.default);
    if (profile !== undefined) return { profile };
  }
  if (registered.length === 1) return { profile: context.profiles.get(registered[0]) as StructuredExchangeProfile };
  return { refused: `this project registers ${registered.length} profiles and no default; name one of ${quoted(registered)}` };
}

/** The attributes a rule selects on: an item or end lacking one is not selected. */
function selectedOn(rule: ProfileRule): string | null {
  if (rule.element !== undefined) {
    const names = Object.keys(rule.when ?? {});
    return names.length === 0 ? null : names.join(", ");
  }
  const names = [
    ...Object.keys(rule.when?.from ?? {}).map((name) => `source ${name}`),
    ...Object.keys(rule.when?.to ?? {}).map((name) => `target ${name}`),
  ];
  return names.length === 0 ? null : names.join(", ");
}

const appliesTo = (rule: ProfileRule): string => (rule.element !== undefined ? `element ${rule.element}` : `relationship ${rule.relationship}`);
const whenOf = (rule: ProfileRule): string => (rule.element !== undefined ? describeConditions(rule.when) : describeLinkConditions(rule.when));
const thenOf = (rule: ProfileRule): string =>
  rule.then === "forbidden" ? "forbidden" : rule.element !== undefined ? describeConditions(rule.then) : describeLinkConditions(rule.then as never);

const artifactsOf = (sources: readonly ViewSource[]) =>
  sources.length === 0 ? {} : { artifacts: sources.map((source) => ({ rel: "generatedFrom", uri: source.path, sha256: source.sha256 })) };

/** The view if the contract accepts it, else why not — naming the first few rules it breaks. */
function checked(document: Record<string, unknown>, what: string): ProjectView {
  const verdict = parseStructuredExchange(document, checkStructuredExchangeSchema);
  if (verdict.valid) return { document };
  const broken = verdict.issues
    .slice(0, 3)
    .map((issue) => `${issue.rule} at ${issue.path || "(document)"}${issue.limit === undefined ? "" : ` (limit ${issue.limit})`}`)
    .join("; ");
  return { refused: `the ${what} does not fit the structured-exchange contract: ${broken}` };
}

export const RULES_REGISTER_COLUMNS = ["id", "level", "applies to", "when", "then", "statement", "source", "not selected without"] as const;

/**
 * A profile's rules as a table: one chapter per kind a rule targets — element kinds, then
 * relationship kinds, in the profile's order — and a row per rule in the registry's order.
 */
export function rulesRegister(profile: StructuredExchangeProfile, rules: readonly ProfileRule[], sources: readonly ViewSource[]): ProjectView {
  const rows: unknown[] = [{ heading: `Rules of ${profile.id} — ${profile.label}`, depth: 1 }];
  const chapters = [
    ...(profile.elementKinds ?? []).map((declaration) => ({
      heading: `element kind ${declaration.kind}`,
      rules: rules.filter((rule) => rule.element === declaration.kind),
    })),
    ...(profile.relationshipKinds ?? []).map((declaration) => ({
      heading: `relationship kind ${declaration.kind}`,
      rules: rules.filter((rule) => rule.relationship === declaration.kind),
    })),
  ].filter((chapter) => chapter.rules.length > 0);

  if (chapters.length === 0) rows.push({ heading: "No rules: no rules file names this profile", depth: 2 });
  for (const chapter of chapters) {
    rows.push({ heading: chapter.heading, depth: 2 });
    for (const rule of chapter.rules) {
      rows.push({
        id: rule.id,
        kind: `${rule.level} rule`,
        cells: [rule.id, rule.level, appliesTo(rule), whenOf(rule), thenOf(rule), rule.statement, rule.source ?? null, selectedOn(rule)],
      });
    }
  }

  return checked(
    {
      schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
      kind: "table",
      profile: STRUCTURED_EXCHANGE_RULES_REGISTER_PROFILE,
      ...artifactsOf(sources),
      data: { columns: [...RULES_REGISTER_COLUMNS], rows },
    },
    "rules register",
  );
}

/** A set of conditions as a pattern label reads it: each attribute with its alternatives. */
const patternConditions = (set: Record<string, readonly (string | number | boolean)[]> | undefined): string =>
  Object.entries(set ?? {})
    .map(([name, values]) => `${name} = ${values.map(String).join(" | ")}`)
    .join(", ");

/** The label a container can carry: the statement is shortened here only, the register holds it whole. */
function containerLabel(rule: ProfileRule): string {
  const head = `${rule.level.toUpperCase()} · ${rule.id} — `;
  const limit = STRUCTURED_EXCHANGE_CEILINGS.label;
  const full = head + rule.statement;
  if (full.length <= limit) return full;
  return `${full.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * A profile's rules drawn one by one, each in its own frame: what a rule selects and what
 * it requires, on the kinds its relationship's ends allow. One frame per rule, so a reader
 * never takes two populations drawn side by side for two families of items.
 */
export function rulePatterns(profile: StructuredExchangeProfile, rules: readonly ProfileRule[], sources: readonly ViewSource[]): ProjectView {
  if (rules.length === 0) return { refused: `profile "${profile.id}" has no rules, so there is no pattern to draw` };
  const nodes: Record<string, unknown>[] = [];
  const edges: Record<string, unknown>[] = [];
  const containers: Record<string, unknown>[] = [];

  rules.forEach((rule, index) => {
    const container = `rule-${index + 1}`;
    containers.push({ id: container, label: containerLabel(rule), kind: `${rule.level} rule` });

    if (rule.element !== undefined) {
      const parts = [rule.element];
      if (rule.when !== undefined && Object.keys(rule.when).length > 0) parts.push(`when ${patternConditions(rule.when)}`);
      parts.push(rule.then === "forbidden" ? "forbidden" : `must have ${patternConditions(rule.then)}`);
      nodes.push({ id: `${container}-item`, label: parts.join(" · "), kind: rule.then === "forbidden" ? PATTERN_KINDS.forbiddenItem : PATTERN_KINDS.selectedItem, container });
      return;
    }

    const declaration = (profile.relationshipKinds ?? []).find((each) => each.kind === rule.relationship);
    const then = rule.then === "forbidden" ? undefined : rule.then;
    for (const side of ["from", "to"] as const) {
      const when = rule.when?.[side];
      const must = then?.[side];
      const parts = [declaration?.[side]?.join(" | ") ?? "any element kind"];
      if (when !== undefined && Object.keys(when).length > 0) parts.push(`when ${patternConditions(when)}`);
      if (must !== undefined && Object.keys(must).length > 0) parts.push(`must have ${patternConditions(must)}`);
      const kind = parts.some((part) => part.startsWith("must have"))
        ? PATTERN_KINDS.mustHold
        : parts.some((part) => part.startsWith("when"))
          ? PATTERN_KINDS.selects
          : PATTERN_KINDS.any;
      nodes.push({ id: `${container}-${side}`, label: parts.join(" · "), kind, container });
    }
    const forbidden = rule.then === "forbidden";
    edges.push({
      from: `${container}-from`,
      to: `${container}-to`,
      kind: forbidden ? `${rule.relationship} (forbidden)` : rule.relationship,
      label: forbidden ? `${rule.relationship} ✗ forbidden` : rule.relationship,
    });
  });

  return checked(
    {
      schema: STRUCTURED_EXCHANGE_SCHEMA_V2,
      kind: "graph",
      profile: STRUCTURED_EXCHANGE_RULE_PATTERNS_PROFILE,
      ...artifactsOf(sources),
      data: { nodes, edges, containers },
    },
    "rule patterns",
  );
}
