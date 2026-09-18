/**
 * Evaluating a project's rules against a document already held to its profile.
 *
 * Every rule here is local: it looks at one item, or at one relationship and its two
 * ends. That is what lets a specification be checked requirement by requirement — a
 * document holding one requirement, its links and the objects they reach carries
 * everything a rule about that requirement can ask.
 *
 * Three outcomes, never a fourth. A rule is satisfied (nothing is said), violated, or
 * **not verifiable** — when an end it needs is outside the document, or is carried only
 * for context and lacks the attribute. Guessing either way would be wrong: a missing
 * neighbour attribute is an export's omission, not the requirement's fault, and passing
 * it silently would call a link verified that nobody checked.
 *
 * Pure: the same verdict in the agent's loop, the reader's statement and the reference
 * validator.
 */
import { endName, readDocument, type DocumentItem } from "./structuredExchangeDocumentItems.ts";
import type { LinkConditions, ProfileRule, RuleConditions, RuleLevel } from "./structuredExchangeProfile.ts";

export interface RuleFinding {
  ruleId: string;
  level: RuleLevel;
  statement: string;
  source?: string;
  outcome: "violated" | "not-verifiable";
  /** JSON Pointer to the item or the relationship the finding is about. */
  path: string;
  /** For an item rule, the item's identifier; for a link rule, the relationship's ends. */
  item?: string;
  from?: string;
  to?: string;
  /** For a link rule, an identity stable across documents: the relation's `ref`, else its ends and kind. */
  relationship?: string;
  message: string;
}

export interface RuleEvaluationOptions {
  /**
   * The identifiers of the items the document is about. Absent: every item. Other
   * items are carried so link rules can read their attributes, and are never judged.
   */
  subjects?: ReadonlySet<string>;
}

type Truth = "holds" | "fails" | "unknown";

export function evaluateRules(envelope: unknown, rules: readonly ProfileRule[], options: RuleEvaluationOptions = {}): RuleFinding[] {
  const { items, relationships, isSubject, endItem, concernsSubjects } = readDocument(envelope, options.subjects);

  /**
   * Whether a set of conditions holds for an item. On a subject, a missing attribute
   * simply does not match. On an item carried only for context, or an end outside the
   * document, what cannot be read is unknown.
   */
  const judge = (conditions: RuleConditions | undefined, item: DocumentItem | undefined): Truth => {
    const entries = Object.entries(conditions ?? {});
    if (entries.length === 0) return "holds";
    if (item === undefined) return "unknown";
    let unknown = false;
    for (const [name, allowed] of entries) {
      if (!Object.hasOwn(item.attributes, name)) {
        if (isSubject(item)) return "fails";
        unknown = true;
        continue;
      }
      if (!allowed.includes(item.attributes[name] as never)) return "fails";
    }
    return unknown ? "unknown" : "holds";
  };

  const findings: RuleFinding[] = [];
  const identify = (rule: ProfileRule) => ({
    ruleId: rule.id,
    level: rule.level,
    statement: rule.statement,
    ...(rule.source === undefined ? {} : { source: rule.source }),
  });
  const cite = (rule: ProfileRule) => `rule "${rule.id}"${rule.source === undefined ? "" : ` (${rule.source})`}: ${rule.statement}`;

  for (const rule of rules) {
    if (rule.element !== undefined) {
      for (const item of items) {
        if (item.kind !== rule.element || !isSubject(item)) continue;
        if (judge(rule.when, item) !== "holds") continue;
        const violated = rule.then === "forbidden" || judge(rule.then, item) === "fails";
        if (!violated) continue;
        findings.push({
          ...identify(rule),
          outcome: "violated",
          path: item.path,
          ...(item.id === undefined ? {} : { item: item.id }),
          message: cite(rule),
        });
      }
      continue;
    }

    for (const relationship of relationships) {
      if (relationship.kind !== rule.relationship) continue;
      if (!concernsSubjects(relationship)) continue;
      const fromItem = endItem(relationship.from);
      const toItem = endItem(relationship.to);

      const ends = (clause: LinkConditions | undefined): Truth => {
        const truths = [judge(clause?.from, fromItem), judge(clause?.to, toItem)];
        if (truths.includes("fails")) return "fails";
        return truths.includes("unknown") ? "unknown" : "holds";
      };
      const described = {
        from: endName(relationship.from),
        to: endName(relationship.to),
        relationship: relationship.ref ?? `${endName(relationship.from)} -${rule.relationship}-> ${endName(relationship.to)}`,
      };
      const notVerifiable = () =>
        findings.push({
          ...identify(rule),
          outcome: "not-verifiable",
          path: relationship.path,
          ...described,
          message: `${cite(rule)} — not verifiable here: ${described.from} -${rule.relationship}-> ${described.to} needs an attribute this document does not carry`,
        });

      const selected = ends(rule.when);
      if (selected === "fails") continue;
      if (selected === "unknown") {
        notVerifiable();
        continue;
      }
      if (rule.then !== "forbidden") {
        const required = ends(rule.then);
        if (required === "holds") continue;
        if (required === "unknown") {
          notVerifiable();
          continue;
        }
      }
      findings.push({
        ...identify(rule),
        outcome: "violated",
        path: relationship.path,
        ...described,
        message: `${cite(rule)} — ${described.from} -${rule.relationship}-> ${described.to}`,
      });
    }
  }

  // Document order: by pointer position, so a reader meets findings as they meet the document.
  const order = (path: string) => {
    const [, , collection, index] = path.split("/");
    const rank = { nodes: 0, rows: 0, edges: 1, relations: 1 }[collection as "nodes"] ?? 2;
    return rank * 1_000_000 + Number(index);
  };
  return findings.sort((left, right) => order(left.path) - order(right.path));
}
