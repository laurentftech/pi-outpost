/**
 * The tool that shows a project's model back: its rules register or its rule patterns.
 *
 * Two jobs in one call. For the reader, a view generated from the project's own files —
 * never drawn by the model — on which a person confirms that each rule checks what its
 * statement says. For the agent writing those files, the check: an unusable registry comes
 * back issue by issue, with the file and the pointer, and a usable one comes back as the
 * full text listing the agent can compare with what it meant to write.
 *
 * Read-only and without a path argument: it reads only the registry and the files the
 * registry lists, through the same confined reader every other structured-exchange tool
 * uses, and writes nothing.
 */
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH, profileListing, rulesListing } from "@pi-outpost/shared/structured-exchange/profile";
import { rulePatterns, rulesRegister, selectViewProfile } from "@pi-outpost/shared/structured-exchange/project-views";
import { describeUnusableProfiles, readProjectProfiles } from "./structuredExchangeProfiles.ts";

export interface StructuredExchangeProjectModelToolOptions {
  /** The project whose registry is read — not a sandbox root. */
  projectRoot: string;
}

const VIEWS = { "rules-register": "rules register", "rule-patterns": "rule patterns" } as const;
type View = keyof typeof VIEWS;

const parameters = Type.Object({
  view: Type.Union([Type.Literal("rules-register"), Type.Literal("rule-patterns")], {
    description:
      '"rules-register": a table of every rule with what it applies to, when, then, statement and source. "rule-patterns": one small drawing per rule — what it selects and what it requires, on the kinds each end of a relationship allows.',
  }),
  profile: Type.Optional(
    Type.String({ description: "The registered profile's identifier. Omit to use the project's default, or its only profile." }),
  ),
});

const DESCRIPTION = [
  `Present this project's structured-exchange model, generated from its own files (${STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH}, the profiles and the rules files it lists): the rules register or the rule patterns of one registered profile.`,
  "Call it after every change you make to the registry, a profile or a rules file: an error result lists what makes the files unusable, with the file, the rule and a pointer — fix those files and call again.",
  "On success, read the listing it returns and check that each rule's conditions say what its statement says, then ask the user to confirm the rules in the presented view. Never write or draw these views yourself.",
  "Before writing any of those files, read the structured-exchange-project skill.",
].join(" ");

const refused = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined, isError: true });

/**
 * The shape of a rule, said where a model that invents one will read it.
 *
 * Seen live: a model never opened the setup skill and rewrote a rules file some fifty times,
 * guessing `level: "error"`, `where`, `relationshipKind`, each refused by the schema with a
 * pointer and no word of what was expected. The refusal is the one text it reads, so the
 * form goes there — whole, copyable, and in the format's own words.
 */
const RULE_FORM = [
  "",
  "A rules file has this shape — copy it and change the words, do not invent fields:",
  JSON.stringify({
    schema: "urn:structured-exchange-rules:1",
    profile: "<the profile's id>",
    rules: [
      {
        id: "ARP4754A-derived-no-satisfy",
        source: "ARP4754A",
        statement: "<the rule in the source's own words>",
        level: "refuse",
        relationship: "satisfies",
        when: { from: { category: ["derived"] } },
        then: "forbidden",
      },
      {
        id: "SAF-approved",
        statement: "<the rule in the source's own words>",
        level: "report",
        element: "requirement",
        when: { safety: ["yes"] },
        then: { status: ["approved"] },
      },
    ],
  }),
  '`level` is "refuse" or "report". A rule names `element` (one item) or `relationship` (a link; its conditions go under `from` and `to`). `when` selects, `then` requires — or is "forbidden". Values are lists. The attribute names and values must be the profile\'s own. If this is still unclear, ask the user to open the structured-exchange-project skill (/skill:structured-exchange-project).',
].join("\n");

/** Whether an unusable registry is so because a rules file does not have the format's shape. */
const breaksRulesShape = (issues: readonly { rule: string }[]): boolean =>
  issues.some((issue) => issue.rule.startsWith("rules-format/schema/"));

export function createStructuredExchangeProjectModelToolDefinition(options: StructuredExchangeProjectModelToolOptions): ToolDefinition {
  return {
    name: "present_project_model",
    label: "Project model",
    description: DESCRIPTION,
    promptSnippet: "Present the project's rules register or rule patterns, and check its registry, profiles and rules",
    promptGuidelines: [
      "After writing or changing a structured-exchange registry, profile or rules file, call present_project_model to check the files and show the result to the user.",
    ],
    parameters,
    async execute(_toolCallId, params) {
      const { view, profile: named } = params as { view: View; profile?: string };

      // Read now, not at construction: the file the agent just wrote is the one checked.
      const project = await readProjectProfiles(options.projectRoot);
      if (project.state === "none") {
        return refused(
          `Nothing was presented: this project has no structured-exchange registry. A project declares its profiles and rules in ${STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH}, at the project root; read the structured-exchange-project skill to set one up.`,
        );
      }
      if (project.state === "unusable") {
        return refused(
          [
            "Nothing was presented: this project's structured-exchange registry cannot be used. Every document is refused until these are fixed:",
            ...describeUnusableProfiles(project.issues),
            ...(breaksRulesShape(project.issues) ? [RULE_FORM] : []),
          ].join("\n"),
        );
      }

      const choice = selectViewProfile(project.context, named);
      if ("refused" in choice) return refused(`Nothing was presented: ${choice.refused}.`);
      const { profile } = choice;
      const rules = project.context.rules?.get(profile.id) ?? [];
      const sources = project.filesByProfile.get(profile.id) ?? [];
      const generated = view === "rules-register" ? rulesRegister(profile, rules, sources) : rulePatterns(profile, rules, sources);
      if ("refused" in generated) return refused(`Nothing was presented: ${generated.refused}.`);

      const text = [
        `Presented the ${VIEWS[view]} of profile "${profile.id}", generated from ${sources.map((source) => source.path).join(", ")}.`,
        "",
        profileListing(profile),
        rulesListing(profile.id, rules),
        "Check each rule above: do its conditions say what its statement says? Then ask the user to confirm them in the presented view — rules are written, or at least validated, by people.",
      ].join("\n");
      return {
        content: [{ type: "text", text }],
        // The channel the interface reads; the model reads the listing above.
        details: generated.document,
      };
    },
  } as ToolDefinition;
}
