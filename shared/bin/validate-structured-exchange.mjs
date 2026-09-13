#!/usr/bin/env node
/* global __VALIDATOR_VERSION__ */
/**
 * The reference validation interface.
 *
 * Reads a candidate structured-exchange document from a file or from standard
 * input, applies the committed schema and the same semantic rules the application
 * applies on receipt, and prints a machine-readable verdict.
 *
 *   validate-structured-exchange doc.json
 *   cat doc.json | validate-structured-exchange
 *
 * It also checks profiles, where they are built — outside any project that will hold
 * documents to them:
 *
 *   validate-structured-exchange --check-profile profile.json
 *   validate-structured-exchange --profile profile.json doc.json
 *   validate-structured-exchange --describe-profile profile.json
 *
 * And a project's registry — its profiles and their rules — exactly as the agent's
 * tools read it, including over a whole specification exported requirement by
 * requirement:
 *
 *   validate-structured-exchange --registry .pi-outpost/structured-exchange.json
 *   validate-structured-exchange --registry .pi-outpost/structured-exchange.json doc.json
 *   validate-structured-exchange --registry .pi-outpost/structured-exchange.json --describe-profile
 *   validate-structured-exchange --registry .pi-outpost/structured-exchange.json \
 *     --batch spec.jsonl --report report.json --report-markdown report.md
 *   validate-structured-exchange --markdown table.json
 *
 * This source imports the repository's TypeScript directly and therefore only runs
 * inside the monorepo. The artifact a producer actually gets is the bundle built
 * from it by `npm run build:validator`, which carries the schemas and the rules
 * inside itself and needs nothing but Node — see shared/dist/.
 *
 * Exit codes, which are the interface for anything driving this from a build:
 *
 *   0  the document (or the profile, the registry, the batch) conforms
 *   1  the document was read and parsed, and does not conform; in a batch, a
 *      requirement is non-conforming or a line is unreadable
 *   2  the input could not be read at all, or the arguments are not usable
 *   3  the input was read and is not JSON
 *   4  the profile or registry could not be read, is not JSON, or does not conform
 *
 * The distinction between 2, 3 and 1 matters: a missing file and a malformed
 * document send a producer looking in completely different places, and reporting
 * either as "invalid document" sends them to the schema for a problem that is not
 * there. 4 is the same distinction one level up: a profile that is wrong is not a
 * document that strays from it, and whoever fixes one is rarely whoever fixes the
 * other.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseSerializedStructuredExchange } from "../src/structuredExchangeParse.ts";
import { checkStructuredExchangeSchema } from "../src/structuredExchangeSchemaNode.ts";
import { profileListing, rulesListing } from "../src/structuredExchangeProfile.ts";
import { validateProfile } from "../src/structuredExchangeProfileValidation.ts";
import { holdToProfile } from "../src/structuredExchangeProfileCheck.ts";
import { readProjectRegistry } from "../src/structuredExchangeProjectRegistry.ts";
import { buildConformityReport, readBatch } from "../src/structuredExchangeConformityReport.ts";
import { tableMarkdown } from "../src/structuredExchangeTableExport.ts";

/** Stamped into the bundle at build time; the monorepo source says what it is. */
const VERSION = `validate-structured-exchange ${typeof __VALIDATOR_VERSION__ === "undefined" ? "development" : __VALIDATOR_VERSION__}`;

const USAGE = `validate-structured-exchange [file]
validate-structured-exchange --profile <profile.json> [file]
validate-structured-exchange --check-profile <profile.json>
validate-structured-exchange --describe-profile <profile.json>
validate-structured-exchange --registry <registry.json> [file]
validate-structured-exchange --registry <registry.json> --describe-profile [profile-id]
validate-structured-exchange --registry <registry.json> --batch <spec.jsonl>
                             [--report <report.json>] [--report-markdown <report.md>]
validate-structured-exchange --markdown [file]

Validates a structured-exchange document against the contract it declares:
urn:structured-exchange:1 or urn:structured-exchange:2. A document naming any
other version is refused as unsupported rather than judged by the wrong one.
Reads standard input when no file is given. Prints a JSON verdict on stdout.

--profile        also holds the document to a profile (urn:structured-exchange-profile:1),
                 after the contract: a document naming no profile is held to it, one
                 naming a different profile is refused.
--check-profile  checks a profile file on its own.
--describe-profile
                 prints a profile as plain text — every kind, attribute and enumeration
                 value — for reviewing it against the model it was built from. With
                 --registry, prints the registry's profiles (or the one named) and every
                 rule beside the conditions it checks.
--registry       a project registry (urn:structured-exchange-profile-registry:1). Alone,
                 checks it with its profiles and rules files; with a file, holds the
                 document to it as the agent's tools do — the contract, the profile, then
                 its rules. Paths in the registry resolve against the project directory:
                 the parent of .pi-outpost/ when the registry sits there, else the
                 registry's own directory.
--batch          validates a specification requirement by requirement (needs --registry).
                 JSON Lines: {"heading": "1. Braking", "depth": 1} or
                 {"document": {...}, "subjects": ["req-12"]}. Prints a summary.
--report         writes the conformity report as a structured-exchange table.
--report-markdown
                 writes the conformity report as Markdown, complete whatever its size.
--markdown       prints a valid table as Markdown, as the reader's export writes it.

Exit codes: 0 conforms, 1 does not conform (in a batch: a non-conforming requirement
or an unreadable line; findings to check do not fail a run), 2 unreadable input or
unusable arguments, 3 not JSON, 4 the profile or registry is unreadable, not JSON,
or does not conform.`;

/** Flags followed by a value; --describe-profile's is optional beside --registry. */
const VALUE_FLAGS = ["--profile", "--check-profile", "--describe-profile", "--registry", "--batch", "--report", "--report-markdown"];
const SWITCHES = ["--markdown"];

function emit(verdict, code) {
  process.stdout.write(JSON.stringify(verdict) + "\n");
  process.exit(code);
}

function refuseArguments(message) {
  emit({ valid: false, issues: [{ rule: "invalid-arguments", path: "", message }] }, 2);
}

/** The profile named on the command line, or an exit with status 4 saying why not. */
function loadProfile(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    emit({ valid: false, subject: "profile", issues: [{ rule: "profile-format/unreadable", path: "", message: `could not read ${file}: ${error.message}` }] }, 4);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    emit({ valid: false, subject: "profile", issues: [{ rule: "profile-format/not-json", path: "", message: `${file} is not JSON: ${error.message}` }] }, 4);
  }
  const verdict = validateProfile(value);
  if (!verdict.valid) emit({ valid: false, subject: "profile", issues: verdict.issues }, 4);
  return verdict.profile;
}

/**
 * The registry named on the command line, read by the reader the agent's tools use, or
 * an exit with status 4. Returns the project directory too: report artifacts name files
 * as the registry does, relative to it.
 */
async function loadRegistry(file) {
  const absolute = path.resolve(file);
  const directory = path.dirname(absolute);
  const project = path.basename(directory) === ".pi-outpost" ? path.dirname(directory) : directory;
  const relative = path.relative(project, absolute);
  const read = await readProjectRegistry(project, relative);
  if (read.state === "none") {
    emit({ valid: false, subject: "registry", issues: [{ rule: "registry/unreadable", path: "", file: relative, message: `could not read ${file}: it does not exist` }] }, 4);
  }
  if (read.state === "unusable") emit({ valid: false, subject: "registry", issues: read.issues }, 4);
  return { context: read.context, files: read.files };
}

/** A document from a file or standard input, parsed against the contract, or an exit saying why not. */
function readDocument(file) {
  let serialized;
  try {
    serialized = file === undefined ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  } catch (error) {
    emit(
      {
        valid: false,
        issues: [
          {
            rule: "unreadable-input",
            path: "",
            message: file === undefined ? `could not read standard input: ${error.message}` : `could not read ${file}: ${error.message}`,
          },
        ],
      },
      2,
    );
  }
  const verdict = parseSerializedStructuredExchange(serialized, checkStructuredExchangeSchema);
  if (!verdict.valid) {
    // Not JSON at all is a different report from JSON that says the wrong thing.
    const notJson = verdict.issues.some((issue) => issue.rule === "not-json");
    emit({ valid: false, issues: verdict.issues }, notJson ? 3 : 1);
  }
  return verdict;
}

function writeOutput(file, text) {
  try {
    writeFileSync(file, text);
  } catch (error) {
    emit({ valid: false, issues: [{ rule: "unwritable-output", path: "", message: `could not write ${file}: ${error.message}` }] }, 2);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }

  // A flag and the file it names; anything else not starting with "-" is the document.
  const flags = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (VALUE_FLAGS.includes(argument)) {
      if (flags.has(argument)) refuseArguments(`${argument} is given twice`);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        // Beside a registry, --describe-profile lists every profile when none is named.
        if (argument === "--describe-profile" && argv.includes("--registry")) {
          flags.set(argument, undefined);
          continue;
        }
        refuseArguments(`${argument} needs a ${argument === "--describe-profile" || argument.endsWith("profile") ? "profile" : "file"}`);
      }
      flags.set(argument, value);
      index += 1;
    } else if (SWITCHES.includes(argument)) {
      flags.set(argument, true);
    } else if (!argument.startsWith("-")) {
      positional.push(argument);
    }
  }
  const has = (flag) => flags.has(flag);
  const exclusive = ["--profile", "--check-profile", "--registry", "--markdown"].filter(has);
  if (exclusive.length > 1) refuseArguments(`use one of ${exclusive.join(", ")} at a time`);
  if (has("--describe-profile") && (has("--profile") || has("--check-profile") || has("--markdown"))) {
    refuseArguments("--describe-profile takes a profile file, or --registry");
  }
  if (has("--batch") && !has("--registry")) refuseArguments("--batch needs --registry: a batch is checked against a project's profiles and rules");
  for (const flag of ["--report", "--report-markdown"]) if (has(flag) && !has("--batch")) refuseArguments(`${flag} writes a batch's report and needs --batch`);
  if ((has("--describe-profile") || has("--check-profile") || has("--batch")) && positional.length > 0) {
    refuseArguments("a profile listing, a profile check or a batch takes no document");
  }
  if (has("--registry") && has("--describe-profile") && has("--batch")) refuseArguments("use --describe-profile or --batch, not both");
  if (positional.length > 1) refuseArguments("give one document at a time; a specification is validated with --batch");

  if (has("--registry")) {
    const registry = await loadRegistry(flags.get("--registry"));
    if (has("--describe-profile")) return describeRegistry(registry, flags.get("--describe-profile"));
    if (has("--batch")) return runBatch(registry, flags.get("--batch"), flags.get("--report"), flags.get("--report-markdown"));
    if (positional.length === 0) {
      emit({ valid: true, subject: "registry", profiles: [...registry.context.profiles.keys()], files: registry.files }, 0);
    }
    return validateAgainstRegistry(registry, positional[0]);
  }

  if (has("--check-profile") || has("--describe-profile")) {
    const flag = has("--check-profile") ? "--check-profile" : "--describe-profile";
    const profile = loadProfile(flags.get(flag));
    if (flag === "--describe-profile") {
      process.stdout.write(profileListing(profile));
      process.exit(0);
    }
    emit({ valid: true, subject: "profile", id: profile.id }, 0);
  }

  if (has("--markdown")) {
    const verdict = readDocument(positional[0]);
    if (verdict.envelope.kind !== "table") {
      emit({ valid: false, issues: [{ rule: "markdown/not-a-table", path: "/kind", message: `a ${verdict.envelope.kind} has no Markdown export; only a table does` }] }, 1);
    }
    process.stdout.write(tableMarkdown(verdict.envelope.data));
    process.exit(0);
  }

  // Loaded before the document is read: a profile that cannot be used says nothing
  // about any document, and reporting the document first would bury the real problem.
  const profile = has("--profile") ? loadProfile(flags.get("--profile")) : undefined;
  const verdict = readDocument(positional[0]);

  if (profile === undefined) {
    emit({ valid: true, kind: verdict.envelope.kind, measurement: verdict.measurement }, 0);
  }

  const named = verdict.envelope.profile;
  if (typeof named === "string" && named !== profile.id) {
    emit(
      {
        valid: false,
        issues: [
          {
            rule: "profile/different-profile",
            path: "/profile",
            message: `the document names profile "${named}", and it was checked against "${profile.id}"`,
          },
        ],
      },
      1,
    );
  }

  // The given profile acts as the default would in a project: a document naming none
  // is held to it, and a version 1 document, which cannot name one, is refused.
  const held = holdToProfile(verdict.envelope, { profiles: new Map([[profile.id, profile]]), default: profile.id });
  if (held.outcome === "refused") emit({ valid: false, issues: held.issues }, 1);
  emit(
    {
      valid: true,
      kind: verdict.envelope.kind,
      measurement: verdict.measurement,
      profile:
        held.outcome === "conforms"
          ? { id: held.profile, applied: true, notes: held.notes }
          : // A sequence: profiles do not constrain one, and the verdict says so rather than implying a check.
            { id: profile.id, applied: false },
    },
    0,
  );
}

/** Every profile of the registry, or the one named, each followed by its rules. */
function describeRegistry(registry, profileId) {
  const profiles = [...registry.context.profiles.values()];
  const listed = profileId === undefined ? profiles : profiles.filter((profile) => profile.id === profileId);
  if (listed.length === 0) {
    refuseArguments(`the registry has no profile "${profileId}"; it registers ${profiles.map((profile) => `"${profile.id}"`).join(", ")}`);
  }
  const text = listed
    .map((profile) => `${profileListing(profile)}\n${rulesListing(profile.id, registry.context.rules?.get(profile.id) ?? [])}`)
    .join("\n");
  process.stdout.write(text);
  process.exit(0);
}

/** One document held to the registry, as present_structure holds it. */
function validateAgainstRegistry(registry, file) {
  const verdict = readDocument(file);
  const held = holdToProfile(verdict.envelope, registry.context);
  if (held.outcome === "refused") emit({ valid: false, issues: held.issues }, 1);
  emit(
    {
      valid: true,
      kind: verdict.envelope.kind,
      measurement: verdict.measurement,
      profile:
        held.outcome === "conforms"
          ? { id: held.profile, applied: true, notes: held.notes, findings: held.findings ?? [] }
          : // Named no profile and the registry has no default, or a sequence: nothing held it.
            { applied: false },
    },
    0,
  );
}

/** A specification, line by line, into a conformity report. */
function runBatch(registry, batchFile, reportFile, markdownFile) {
  let text;
  try {
    text = readFileSync(batchFile, "utf8");
  } catch (error) {
    emit({ valid: false, subject: "batch", issues: [{ rule: "unreadable-input", path: "", message: `could not read ${batchFile}: ${error.message}` }] }, 2);
  }
  const report = buildConformityReport(readBatch(text), registry.context, {
    date: new Date().toISOString(),
    version: VERSION,
    checkedAgainst: registry.files.map((file) => ({ uri: file.path, sha256: file.sha256 })),
  });
  if (markdownFile !== undefined) writeOutput(markdownFile, report.markdown);
  if (reportFile !== undefined && report.table !== undefined) writeOutput(reportFile, JSON.stringify(report.table, null, 2) + "\n");
  const failed = report.counts["non-conforming"] > 0 || report.unreadable.length > 0;
  emit(
    {
      valid: !failed,
      subject: "batch",
      counts: report.counts,
      perRule: report.perRule,
      unreadable: report.unreadable,
      ...(reportFile === undefined ? {} : report.table === undefined ? { reportRefused: report.tableRefused } : { report: reportFile }),
      ...(markdownFile === undefined ? {} : { reportMarkdown: markdownFile }),
    },
    failed ? 1 : 0,
  );
}

await main();
