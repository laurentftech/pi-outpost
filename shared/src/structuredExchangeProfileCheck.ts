/**
 * Holding a structured-exchange document to the profile its project declares.
 *
 * Runs only on a document the core contract already accepted, so it walks validated
 * shapes and never re-litigates them. It decides two things: which profile, if any,
 * a document is held to — and, for one that is held, what it does that the profile
 * does not allow.
 *
 * Every refusal says what the profile allows at the place it points. That is the
 * whole difference between this and a schema error: an agent told `"requirment" is
 * not a kind` guesses; one told the kinds that exist corrects. Nothing is corrected
 * here, and nothing is fetched — a profile is found by exact identifier in a map the
 * caller built from the project's own files.
 *
 * Pure: no compiler, no filesystem. The server, the reference validator and the
 * reader's statement all reach the same verdict because they call the same code.
 */
import { STRUCTURED_EXCHANGE_SCHEMA_V1, readTableRow, type StructuredTableRow } from "./structuredExchange.ts";
import type { ProfileAttribute, ProfileKind, ProfileRule, StructuredExchangeProfile } from "./structuredExchangeProfile.ts";
import type { StructuredExchangeIssue } from "./structuredExchangeValidation.ts";
import { evaluateRules, type RuleEvaluationOptions, type RuleFinding } from "./structuredExchangeRuleEvaluation.ts";

/** A value outside an open enumeration: accepted, and reported so a typo is not taken for a new value. */
export interface ProfileNote {
  rule: "profile/open-enumeration-value";
  path: string;
  message: string;
  value: string;
  declared: string[];
}

export interface ProfileCheckOutcome {
  issues: StructuredExchangeIssue[];
  notes: ProfileNote[];
}

/** The project's usable registry, as the check needs it. */
export interface ProfileContext {
  profiles: ReadonlyMap<string, StructuredExchangeProfile>;
  /** A registered profile's identifier. */
  default?: string;
  /** The rules registered for each profile, by profile identifier, in the registry's order. */
  rules?: ReadonlyMap<string, readonly ProfileRule[]>;
}

export type ProfileSelection =
  | { outcome: "unconstrained" }
  | { outcome: "held"; profile: StructuredExchangeProfile }
  | { outcome: "refused"; issues: StructuredExchangeIssue[] };

export type ProfileVerdictForDocument =
  | { outcome: "unconstrained" }
  | { outcome: "refused"; issues: StructuredExchangeIssue[]; profile?: string }
  | {
      outcome: "conforms";
      profile: string;
      notes: ProfileNote[];
      /**
       * What the profile's rules leave to check: violated report rules and rules not
       * verifiable here. Present only when rules are registered for the profile.
       */
      findings?: RuleFinding[];
    };

type Vocabulary = "element" | "relationship";

const quoted = (values: readonly string[]): string => (values.length === 0 ? "none" : values.map((value) => `"${value}"`).join(", "));

/** One JSON Pointer segment, escaped as RFC 6901 requires. */
function segment(name: string): string {
  return name.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Which profile a document is held to.
 *
 * Without a default, profiles are opt-in: a document naming a registered one is held
 * to it, anything else is judged by the core contract alone, as the opaque-profile
 * rule has always said. With a default, the project has said its documents follow a
 * model, and a document may not step around it — by naming no profile (it gets the
 * default), naming one nobody registered, or declaring version 1, which cannot name
 * one at all. Each of those is what an agent refused by the profile would otherwise
 * learn to do.
 *
 * Sequences are never held: profiles cover the graphs and tables a data model is
 * written in. The ways-around are refused for them too, since those are about what
 * a document claims, not what it draws.
 */
export function selectProfile(envelope: unknown, context: ProfileContext): ProfileSelection {
  const { schema, kind, profile: named } = envelope as { schema?: unknown; kind?: unknown; profile?: unknown };
  const fallback = context.default === undefined ? undefined : context.profiles.get(context.default);
  const registered = quoted([...context.profiles.keys()]);

  if (schema === STRUCTURED_EXCHANGE_SCHEMA_V1) {
    if (context.default === undefined) return { outcome: "unconstrained" };
    return {
      outcome: "refused",
      issues: [
        {
          rule: "profile/version-1-under-default",
          path: "/schema",
          message: `this project holds its documents to profile "${context.default}", which only a version 2 document can be held to; declare "urn:structured-exchange:2"`,
        },
      ],
    };
  }

  let selected: StructuredExchangeProfile | undefined;
  if (typeof named === "string") {
    selected = context.profiles.get(named);
    if (selected === undefined) {
      if (context.default === undefined) return { outcome: "unconstrained" };
      return {
        outcome: "refused",
        issues: [
          {
            rule: "profile/unregistered-profile",
            path: "/profile",
            message: `this project registers no profile "${named}"; registered: ${registered}. Name one of them, or name none to be held to the default "${context.default}"`,
          },
        ],
      };
    }
  } else {
    selected = fallback;
  }

  if (selected === undefined || kind === "sequence") return { outcome: "unconstrained" };
  return { outcome: "held", profile: selected };
}

/** What a document held to `profile` does that the profile does not allow, and what it only reports. */
export function checkAgainstProfile(envelope: unknown, profile: StructuredExchangeProfile): ProfileCheckOutcome {
  const issues: StructuredExchangeIssue[] = [];
  const notes: ProfileNote[] = [];
  const document = envelope as { kind?: unknown; target?: unknown; viewpoints?: unknown; data?: Record<string, unknown> };
  const proposal = document.target !== undefined;
  const vocabularies: Record<Vocabulary, Map<string, ProfileKind>> = {
    element: new Map((profile.elementKinds ?? []).map((declaration) => [declaration.kind, declaration])),
    relationship: new Map((profile.relationshipKinds ?? []).map((declaration) => [declaration.kind, declaration])),
  };

  const describeType = (attribute: ProfileAttribute): string =>
    attribute.type === "enumeration" ? "value of its enumeration" : attribute.type === "reference" ? "reference" : attribute.type;

  function describeValue(value: unknown): string {
    if (Array.isArray(value)) return "a list";
    if (value === null) return "null";
    if (typeof value === "object") return "a reference";
    if (typeof value === "string") return `the string ${JSON.stringify(value)}`;
    return `the ${typeof value} ${String(value)}`;
  }

  function checkScalar(attribute: ProfileAttribute, kind: string, value: unknown, path: string): void {
    const typed =
      attribute.type === "string" || attribute.type === "enumeration"
        ? typeof value === "string"
        : attribute.type === "number"
          ? typeof value === "number"
          : attribute.type === "boolean"
            ? typeof value === "boolean"
            : value !== null && typeof value === "object" && typeof (value as { ref?: unknown }).ref === "string";
    if (!typed) {
      issues.push({
        rule: "profile/attribute-type",
        path,
        message: `attribute "${attribute.name}" of kind "${kind}" holds a ${describeType(attribute)}, and this is ${describeValue(value)}`,
      });
      return;
    }
    if (attribute.type !== "enumeration") return;
    const declared = attribute.values ?? [];
    if (declared.includes(value as string)) return;
    if (attribute.closed) {
      issues.push({
        rule: "profile/closed-enumeration",
        path,
        message: `"${value as string}" is not a value of "${attribute.name}" on kind "${kind}"; profile "${profile.id}" allows ${quoted(declared)}`,
      });
    } else {
      notes.push({
        rule: "profile/open-enumeration-value",
        path,
        value: value as string,
        declared: [...declared],
        message: `"${value as string}" is not among the values profile "${profile.id}" lists for "${attribute.name}" on kind "${kind}" (${quoted(declared)}); accepted, since that enumeration is open`,
      });
    }
  }

  function checkValue(attribute: ProfileAttribute, kind: string, value: unknown, path: string): void {
    if (value === null) {
      if (attribute.required) {
        issues.push({
          rule: "profile/null-required-attribute",
          path,
          message: `attribute "${attribute.name}" is required on kind "${kind}", and null is not a value`,
        });
      }
      return;
    }
    if (Array.isArray(value) !== (attribute.list === true)) {
      issues.push({
        rule: "profile/attribute-type",
        path,
        message: attribute.list
          ? `attribute "${attribute.name}" of kind "${kind}" holds a list of ${describeType(attribute)}s, not one value`
          : `attribute "${attribute.name}" of kind "${kind}" holds one ${describeType(attribute)}, not a list`,
      });
      return;
    }
    if (Array.isArray(value)) value.forEach((item, index) => checkScalar(attribute, kind, item, `${path}/${index}`));
    else checkScalar(attribute, kind, value, path);
  }

  /**
   * One addressable item. The kind checked is the one the item will have: a proposal
   * retyping an item names its new kind in `set`, and the `kind` beside it describes
   * what is being left behind — refusing that would forbid moving an item out of a
   * kind the model no longer has, which is exactly the change a new profile asks for.
   */
  function checkItem(item: Record<string, unknown>, at: string, vocabulary: Vocabulary, noun: string): void {
    const kinds = vocabularies[vocabulary];
    const other = vocabularies[vocabulary === "element" ? "relationship" : "element"];
    const set = (item.set ?? undefined) as Record<string, unknown> | undefined;
    const setKind = typeof set?.kind === "string" ? set.kind : undefined;
    const ownKind = typeof item.kind === "string" ? item.kind : undefined;
    const kind = setKind ?? ownKind;
    const kindAt = setKind !== undefined ? `${at}/set/kind` : `${at}/kind`;

    if (kind === undefined) {
      issues.push({
        rule: "profile/missing-kind",
        path: at,
        message:
          `this ${noun} carries no kind; profile "${profile.id}" holds every ${noun} to one of its ${vocabulary} kinds: ${quoted([...kinds.keys()])}` +
          (item.ref !== undefined ? ". A changed item states its kind too, so its attributes can be checked" : ""),
      });
      return;
    }
    const declaration = kinds.get(kind);
    if (declaration === undefined) {
      issues.push({
        rule: "profile/undeclared-kind",
        path: kindAt,
        message:
          `"${kind}" is not a ${vocabulary} kind of profile "${profile.id}"; it declares ${quoted([...kinds.keys()])}` +
          (other.has(kind) ? ` ("${kind}" is one of its ${vocabulary === "element" ? "relationship" : "element"} kinds, which is a different vocabulary)` : ""),
      });
      return;
    }

    const attributes = new Map((declaration.attributes ?? []).map((attribute) => [attribute.name, attribute]));
    const checkAttributes = (values: unknown, base: string): void => {
      if (values === null || typeof values !== "object") return;
      for (const [name, value] of Object.entries(values as Record<string, unknown>)) {
        const path = `${base}/${segment(name)}`;
        const attribute = attributes.get(name);
        if (attribute === undefined) {
          issues.push({
            rule: "profile/undeclared-attribute",
            path,
            message: `kind "${kind}" of profile "${profile.id}" has no attribute "${name}"; it declares ${quoted([...attributes.keys()])}`,
          });
          continue;
        }
        checkValue(attribute, kind, value, path);
      }
    };
    checkAttributes(item.attributes, `${at}/attributes`);
    checkAttributes(set?.attributes, `${at}/set/attributes`);

    const required = (declaration.attributes ?? []).filter((attribute) => attribute.required === true);
    // An item a proposal adds has nothing to leave unchanged, so it carries every
    // required attribute exactly as it would in a complete document.
    const whole = !proposal || item.ref === undefined;
    if (whole) {
      const carried = (item.attributes ?? {}) as Record<string, unknown>;
      for (const attribute of required) {
        if (Object.hasOwn(carried, attribute.name)) continue;
        issues.push({
          rule: "profile/missing-required-attribute",
          path: at,
          message: `kind "${kind}" requires attribute "${attribute.name}", and this ${noun} does not carry it`,
        });
      }
    }
    const removed = set?.removeAttributes;
    if (Array.isArray(removed)) {
      removed.forEach((name, index) => {
        if (!required.some((attribute) => attribute.name === name)) return;
        issues.push({
          rule: "profile/required-attribute-removed",
          path: `${at}/set/removeAttributes/${index}`,
          message: `attribute "${String(name)}" is required on kind "${kind}", so a proposal cannot remove it`,
        });
      });
    }
  }

  const data = document.data ?? {};
  if (document.kind === "graph") {
    ((data.nodes ?? []) as Record<string, unknown>[]).forEach((node, index) =>
      checkItem(node, `/data/nodes/${index}`, "element", "element"),
    );
    ((data.edges ?? []) as Record<string, unknown>[]).forEach((edge, index) =>
      checkItem(edge, `/data/edges/${index}`, "relationship", "relationship"),
    );
  } else if (document.kind === "table") {
    ((data.rows ?? []) as StructuredTableRow[]).forEach((row, index) => {
      // A heading organises the table; it is not a thing of the model.
      if (readTableRow(row).heading !== undefined) return;
      checkItem(Array.isArray(row) ? {} : (row as unknown as Record<string, unknown>), `/data/rows/${index}`, "element", "row");
    });
    ((data.relations ?? []) as Record<string, unknown>[]).forEach((relation, index) =>
      checkItem(relation, `/data/relations/${index}`, "relationship", "relation"),
    );
  }

  // A document's viewpoint and its profile's under one identifier: a figure asked for
  // it could only guess which was meant.
  const profileViewpoints = new Set((profile.viewpoints ?? []).map((viewpoint) => viewpoint.id));
  if (Array.isArray(document.viewpoints)) {
    (document.viewpoints as { id?: unknown }[]).forEach((viewpoint, index) => {
      if (typeof viewpoint.id !== "string" || !profileViewpoints.has(viewpoint.id)) return;
      issues.push({
        rule: "profile/viewpoint-declared-twice",
        path: `/viewpoints/${index}/id`,
        message: `profile "${profile.id}" also declares a viewpoint "${viewpoint.id}"; rename this one, since a figure asked for "${viewpoint.id}" could not tell which is meant`,
      });
    });
  }

  return { issues, notes };
}

/**
 * Selection, vocabulary and rules together: the verdict both tools, the reader's
 * statement and the reference validator act on.
 *
 * Rules run only once the vocabulary conforms. A rule condition on a value the profile
 * does not allow would otherwise be judged on a word that is itself the problem, and
 * the producer would be sent to fix a rule's consequence before its cause.
 */
export function holdToProfile(
  envelope: unknown,
  context: ProfileContext,
  options: RuleEvaluationOptions = {},
): ProfileVerdictForDocument {
  const selection = selectProfile(envelope, context);
  if (selection.outcome !== "held") return selection;
  const { issues, notes } = checkAgainstProfile(envelope, selection.profile);
  if (issues.length > 0) return { outcome: "refused", issues, profile: selection.profile.id };

  const rules = context.rules?.get(selection.profile.id);
  if (rules === undefined || rules.length === 0) return { outcome: "conforms", profile: selection.profile.id, notes };

  const evaluated = evaluateRules(envelope, rules, options);
  const refusals = evaluated
    .filter((finding) => finding.level === "refuse" && finding.outcome === "violated")
    .map((finding) => ({ rule: `rule/${finding.ruleId}`, path: finding.path, message: finding.message }));
  if (refusals.length > 0) return { outcome: "refused", issues: refusals, profile: selection.profile.id };
  const findings = evaluated.filter((finding) => !(finding.level === "refuse" && finding.outcome === "violated"));
  return { outcome: "conforms", profile: selection.profile.id, notes, findings };
}
