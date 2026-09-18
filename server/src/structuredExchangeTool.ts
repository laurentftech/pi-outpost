/**
 * The tool that lets the agent be a producer.
 *
 * `details` is filled by a tool's implementation, not by the model — so without
 * this, an agent guided by the structured-exchange skill can author a document and
 * has no way to present one. This closes that gap: the agent hands over the
 * document, and the tool puts it on the channel the interface reads.
 *
 * It also puts validation *inside the loop the agent is already in*. A refused
 * document comes back as this tool's own output, naming the rule and pointing at
 * the value, so the agent corrects and calls again without leaving the turn. That
 * is what makes a strict contract usable by a producer that writes plausible-but-
 * wrong JSON, which is what a language model is.
 *
 * The same loop holds a document to the project's own data model, when the project
 * registers one: after the core contract, the profile — so an invented enumeration
 * value is refused exactly as a dangling endpoint is.
 */
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseSerializedStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import { checkStructuredExchangeSchema } from "@pi-outpost/shared/structured-exchange/schema-node";
import type { StructuredExchangeLimits } from "@pi-outpost/shared/structured-exchange/bounds";
import { holdToProfile, type ProfileNote } from "@pi-outpost/shared/structured-exchange/profile-check";
import type { RuleFinding } from "@pi-outpost/shared/structured-exchange/rule-evaluation";
import type {
  StructuredGraphData,
  StructuredSequenceData,
  StructuredTableData,
  ValidatedStructuredExchange,
} from "@pi-outpost/shared/structured-exchange";
import { describeUnusableProfiles, readProjectProfiles } from "./structuredExchangeProfiles.ts";

const DESCRIPTION = [
  "Present a structured-exchange document — a graph, sequence, or table — so the interface renders it natively.",
  "Emit data, never hand-drawn diagram syntax: what you pass here is validated, shown to the user for approval when it proposes a change, and can be handed on to whatever applies it.",
  "The document is checked against the published schema. If it is refused you get the rule and a pointer to the offending value back; fix it and call again.",
  "A project may also hold its documents to a profile of its own — the kinds, attributes and enumeration values its data model has. A document that strays from it is refused the same way, and the refusal says what the profile allows at that point: use those words, never invent one.",
  "Before authoring a document, read the structured-exchange skill: it shows the shape of each kind of document, how a proposal differs from a description, and what to do when a profile refuses a value.",
  "The structured document does NOT reach you on a later turn — only `summary` does. Write a summary that stands on its own.",
].join(" ");

const parameters = Type.Object({
  document: Type.String({
    description:
      'The structured-exchange document as JSON: {"schema":"urn:structured-exchange:1","kind":"graph"|"sequence"|"table",...}. Include "target" only when proposing a change to something that already exists. A version 2 graph may declare "viewpoints" — named readings, each an id, a label, the concern it frames, and the elementKinds and relationshipKinds it retains — so a reader can select one and a figure can be written for one. A version 2 document may name the "profile" its kinds and attributes come from; in a project that registers profiles, that profile is enforced.',
  }),
  summary: Type.String({
    description:
      "What the document says, in prose, for your own later reference. Required because the structured payload is not sent back to you on subsequent turns.",
  }),
});

export interface StructuredExchangeToolOptions {
  /**
   * The project whose profile registry applies. Required: a construction site that
   * forgot it would present every document unchecked, and nothing would say so.
   */
  projectRoot: string;
  /** Deployment limits, at or below the schema's ceilings. */
  limits?: StructuredExchangeLimits;
}

/** A factual digest of the document, so the summary is never the only account of it. */
function digest(envelope: ValidatedStructuredExchange): string {
  const parts: string[] = [];
  if (envelope.kind === "graph") {
    const data = envelope.data as StructuredGraphData;
    parts.push(`graph: ${data.nodes.length} elements, ${data.edges.length} relationships`);
  } else if (envelope.kind === "sequence") {
    const data = envelope.data as StructuredSequenceData;
    parts.push(`sequence: ${data.participants.length} participants, ${data.messages.length} messages`);
  } else {
    const data = envelope.data as StructuredTableData;
    parts.push(`table: ${data.columns.length} columns, ${data.rows.length} rows`);
  }
  if (envelope.target !== undefined) {
    // Version 1 states a bare reference, version 2 an object carrying the revision
    // it was prepared against. Interpolated as-is, the enriched form read
    // `proposing changes to "[object Object]"` — in the one account of the document
    // the model still has on a later turn, once the structured payload is gone.
    const target = envelope.target as string | { ref?: string; revision?: string };
    const named = typeof target === "string" ? target : (target.ref ?? "");
    const revision = typeof target === "string" ? undefined : target.revision;
    parts.push(
      `proposing changes to "${named}"${revision === undefined ? "" : `, prepared against "${revision}"`}`,
    );
    parts.push(roleTally(envelope));
  }
  return parts.join("; ");
}

/**
 * What the reader will actually see, counted by role — and reported back to the
 * agent, which will not see the rendering.
 *
 * `0 changed` is the number that earns its place here. The reflex when proposing a
 * rename is to write the new name where the old one goes; under this contract that
 * declares the current value instead, and the proposal quietly does nothing.
 * Failing inert is the right behaviour, but silence about it is not, and the agent
 * has no other way to notice.
 */
function roleTally(envelope: ValidatedStructuredExchange): string {
  const subjects: { ref?: string; set?: object }[] = [];
  if (envelope.kind === "graph") {
    const data = envelope.data as StructuredGraphData;
    subjects.push(...data.nodes, ...data.edges);
  } else if (envelope.kind === "sequence") {
    const data = envelope.data as StructuredSequenceData;
    subjects.push(...data.participants, ...data.messages);
  } else {
    // A table is proposable under the enriched contract, and its rows are what a
    // proposal addresses. Counting only graphs and sequences told the agent that a
    // five-row amendment "changes nothing" — a sentence written to correct one
    // specific mistake, fired at a document that had made none, which is an
    // instruction to go and break it.
    const data = envelope.data as StructuredTableData;
    for (const row of data.rows as unknown[]) {
      if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
      const item = row as { ref?: string; set?: object; heading?: string };
      // A chapter is not proposed: it organises the rows around it.
      if (item.heading !== undefined) continue;
      subjects.push({ ...(item.ref === undefined ? {} : { ref: item.ref }), ...(item.set === undefined ? {} : { set: item.set }) });
    }
  }
  const added = subjects.filter((subject) => subject.ref === undefined).length;
  const changed = subjects.filter((subject) => subject.set !== undefined).length;
  const context = subjects.length - added - changed;
  const removed = envelope.removals?.length ?? 0;
  const tally = `${added} added, ${changed} changed, ${context} shown as unchanged context, ${removed} removed`;
  if (changed > 0 || removed > 0 || added > 0) return tally;
  return `${tally} — this proposal changes nothing; a value to change goes in "set", not beside the reference`;
}

/** Diagnostics the agent can act on, in the order it should read them. */
function explain(
  issues: { rule: string; path: string; message: string }[],
  heading = "The document was refused. Nothing was presented. Fix these and call again:",
): string {
  const lines = [heading];
  for (const issue of issues) lines.push(`- ${issue.rule} at ${issue.path === "" ? "(document)" : issue.path}: ${issue.message}`);
  lines.push("Nothing is corrected for you: a near-miss identifier is refused, not guessed at.");
  // Said in the refusal because it is the one text an agent reliably reads. A model shown
  // "allows draft, approved, withdrawn" for a status the user gave as "in review" was seen
  // choosing "draft" and presenting it — a value nobody said was true.
  if (issues.some((issue) => VOCABULARY_RULES.has(issue.rule))) {
    lines.push(
      "If the source you were given uses a word, or links kinds, the profile does not allow, do not replace it with an allowed one you have no grounds for: ask the user which value is true (for a link, which kinds it really joins), or whether the profile should change.",
    );
  }
  // A rule violation in a faithful document is a finding about the source. An agent told
  // only "fix these" would rewire the link to pass, and hide the one thing a review is for.
  if (issues.some((issue) => issue.rule.startsWith("rule/"))) {
    lines.push(
      "A rule/… refusal quotes a rule the project wrote. If your document states what your source says, the source breaks that rule: do not change a link or a value just to make it pass — tell the user which item and which rule, and let them decide.",
    );
  }
  return lines.join("\n");
}

/** Refusals of a word the profile does not have — the ones an agent is tempted to paper over. */
const VOCABULARY_RULES: ReadonlySet<string> = new Set([
  "profile/closed-enumeration",
  "profile/undeclared-kind",
  "profile/undeclared-attribute",
  "profile/end-kind",
]);

/**
 * Values the profile's open enumerations do not list. Accepted — that is what open
 * means — but said out loud, because the agent is the only one who knows whether
 * `"urgnet"` was a new value or a typo, and it will not see the rendering.
 */
function describeNotes(notes: readonly ProfileNote[]): string {
  if (notes.length === 0) return "";
  const lines = ["", "Values outside open enumerations, accepted — make sure each is meant and not a typo:"];
  for (const note of notes) lines.push(`- ${note.path}: ${note.message}`);
  return lines.join("\n");
}

/**
 * What the project's rules leave to check, said to the agent — which will not see the
 * rendering. A violated report rule is accepted but may be a mistake; a rule not
 * verifiable here is a gap in what the document carries, not a verdict.
 */
function describeFindings(findings: readonly RuleFinding[]): string {
  if (findings.length === 0) return "";
  const lines = ["", "Findings to check — the document was presented, but these checks did not pass:"];
  for (const finding of findings) {
    const kind =
      finding.ruleId === "profile/end-not-verifiable"
        ? "relationship end not verifiable here"
        : finding.outcome === "not-verifiable"
          ? "not verifiable here"
          : "report rule violated";
    lines.push(`- ${finding.path} (${kind}): ${finding.message}`);
  }
  lines.push(
    "Tell the user about each. Something not verifiable here needs the linked item in the document: add it with its kind and attributes if you have it. Never invent a value to clear a finding.",
  );
  return lines.join("\n");
}

export function createStructuredExchangeToolDefinition(options: StructuredExchangeToolOptions): ToolDefinition {
  return {
    name: "present_structure",
    label: "Structure",
    description: DESCRIPTION,
    promptSnippet: "Present a graph, sequence, or table as structured data",
    promptGuidelines: [
      "When asked to draw, diagram, or model a structure, use present_structure with data rather than writing diagram syntax by hand.",
      "To propose a change to something that already exists, set `target` and describe only what changes — omitting an element never removes it.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { document, summary } = params as { document: string; summary: string };

      const verdict = parseSerializedStructuredExchange(document, checkStructuredExchangeSchema, options.limits);
      // Read now, not at construction: an edited profile applies to this very call.
      const project = await readProjectProfiles(options.projectRoot);
      if (!verdict.valid) {
        // An error result, so the agent sees this as something to act on rather
        // than as a presentation that happened to be empty.
        //
        // In a project that registers profiles, said to be the contract's refusal. Once
        // an agent has met one profile refusal it reads every later refusal as the
        // profile's, and a model driven that way was seen deciding the profile imposed
        // a "hybrid schema" and abandoning a table it had nearly right.
        const heading =
          project.state === "none"
            ? undefined
            : "The document was refused by the structured-exchange contract itself — not by this project's profile, which is only applied once the contract is satisfied. Nothing was presented. Fix these and call again:";
        return { content: [{ type: "text", text: explain(verdict.issues, heading) }], details: undefined, isError: true };
      }
      if (project.state === "unusable") {
        // Never degraded to the core contract alone: a registry the project wrote and
        // got wrong would otherwise remove every guarantee while everything looked fine.
        const text = [
          "The document was not presented: this project's structured-exchange profile registry cannot be used, so no document can be checked against it. These project files need fixing — tell the user if that is not yours to do; present_project_model lists every issue again after each fix:",
          ...describeUnusableProfiles(project.issues),
        ].join("\n");
        return { content: [{ type: "text", text }], details: undefined, isError: true };
      }

      let conformance = "";
      if (project.state === "usable") {
        const held = holdToProfile(verdict.envelope, project.context);
        if (held.outcome === "refused") {
          const heading =
            held.profile === undefined
              ? "The document was refused by this project's profile rules. Nothing was presented. Fix these and call again:"
              : `The document was refused by this project's profile "${held.profile}". Nothing was presented. Fix these and call again:`;
          return { content: [{ type: "text", text: explain(held.issues, heading) }], details: undefined, isError: true };
        }
        if (held.outcome === "conforms") {
          const findings = held.findings ?? [];
          const counts = [
            held.notes.length === 0 ? undefined : `${held.notes.length} value${held.notes.length === 1 ? "" : "s"} outside open enumerations`,
            findings.length === 0 ? undefined : `${findings.length} finding${findings.length === 1 ? "" : "s"} to check`,
          ].filter((part) => part !== undefined);
          conformance = `; conforms to this project's profile "${held.profile}"${counts.length === 0 ? "" : `, with ${counts.join(" and ")}`}`;
          conformance += `)${describeNotes(held.notes)}${describeFindings(findings)}`;
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `${summary}\n\n(${digest(verdict.envelope)}${conformance === "" ? ")" : conformance}`,
          },
        ],
        // The channel the interface reads. Not sent to the model, which is why the
        // summary above has to carry the meaning forward on its own.
        details: verdict.envelope,
      };
    },
  } as ToolDefinition;
}
