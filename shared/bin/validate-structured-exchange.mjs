#!/usr/bin/env node
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
 * This source imports the repository's TypeScript directly and therefore only runs
 * inside the monorepo. The artifact a producer actually gets is the bundle built
 * from it by `npm run build:validator`, which carries the schemas and the rules
 * inside itself and needs nothing but Node — see shared/dist/.
 *
 * Exit codes, which are the interface for anything driving this from a build:
 *
 *   0  the document (or the profile) conforms
 *   1  the document was read and parsed, and does not conform
 *   2  the input could not be read at all, or the arguments are not usable
 *   3  the input was read and is not JSON
 *   4  the profile could not be read, is not JSON, or does not conform
 *
 * The distinction between 2, 3 and 1 matters: a missing file and a malformed
 * document send a producer looking in completely different places, and reporting
 * either as "invalid document" sends them to the schema for a problem that is not
 * there. 4 is the same distinction one level up: a profile that is wrong is not a
 * document that strays from it, and whoever fixes one is rarely whoever fixes the
 * other.
 */
import { readFileSync } from "node:fs";
import { parseSerializedStructuredExchange } from "../src/structuredExchangeParse.ts";
import { checkStructuredExchangeSchema } from "../src/structuredExchangeSchemaNode.ts";
import { profileListing } from "../src/structuredExchangeProfile.ts";
import { validateProfile } from "../src/structuredExchangeProfileValidation.ts";
import { holdToProfile } from "../src/structuredExchangeProfileCheck.ts";

const USAGE = `validate-structured-exchange [file]
validate-structured-exchange --profile <profile.json> [file]
validate-structured-exchange --check-profile <profile.json>
validate-structured-exchange --describe-profile <profile.json>

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
                 value — for reviewing it against the model it was built from.

Exit codes: 0 conforms, 1 does not conform, 2 unreadable input or unusable arguments,
3 not JSON, 4 the profile is unreadable, not JSON, or does not conform.`;

const PROFILE_FLAGS = ["--profile", "--check-profile", "--describe-profile"];

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

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }

  // A flag and the file it names; anything else not starting with "-" is the document.
  const modes = [];
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (PROFILE_FLAGS.includes(argument)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) refuseArguments(`${argument} needs a profile file`);
      modes.push({ flag: argument, file: value });
      index += 1;
    } else if (!argument.startsWith("-")) {
      positional.push(argument);
    }
  }
  if (modes.length > 1) refuseArguments(`use one of ${PROFILE_FLAGS.join(", ")} at a time`);
  const mode = modes[0];

  if (mode?.flag === "--check-profile" || mode?.flag === "--describe-profile") {
    if (positional.length > 0) refuseArguments(`${mode.flag} checks a profile and takes no document`);
    const profile = loadProfile(mode.file);
    if (mode.flag === "--describe-profile") {
      process.stdout.write(profileListing(profile));
      process.exit(0);
    }
    emit({ valid: true, subject: "profile", id: profile.id }, 0);
  }

  // Loaded before the document is read: a profile that cannot be used says nothing
  // about any document, and reporting the document first would bury the real problem.
  const profile = mode?.flag === "--profile" ? loadProfile(mode.file) : undefined;

  const file = positional[0];
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

main();
