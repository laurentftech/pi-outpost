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
 * This source imports the repository's TypeScript directly and therefore only runs
 * inside the monorepo. The artifact a producer actually gets is the bundle built
 * from it by `npm run build:validator`, which carries the schema and the rules
 * inside itself and needs nothing but Node — see shared/dist/.
 *
 * Exit codes, which are the interface for anything driving this from a build:
 *
 *   0  the document conforms
 *   1  the document was read and parsed, and does not conform
 *   2  the input could not be read at all
 *   3  the input was read and is not JSON
 *
 * The distinction between 2, 3 and 1 matters: a missing file and a malformed
 * document send a producer looking in completely different places, and reporting
 * either as "invalid document" sends them to the schema for a problem that is not
 * there.
 */
import { readFileSync } from "node:fs";
import { parseSerializedStructuredExchange } from "../src/structuredExchangeParse.ts";
import { checkStructuredExchangeSchema } from "../src/structuredExchangeSchemaNode.ts";

const USAGE = `validate-structured-exchange [file]

Validates a structured-exchange document against the contract it declares:
urn:structured-exchange:1 or urn:structured-exchange:2. A document naming any
other version is refused as unsupported rather than judged by the wrong one.
Reads standard input when no file is given. Prints a JSON verdict on stdout.

Exit codes: 0 conforms, 1 does not conform, 2 unreadable input, 3 not JSON.`;

function emit(verdict, code) {
  process.stdout.write(JSON.stringify(verdict) + "\n");
  process.exit(code);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }

  const file = argv.find((argument) => !argument.startsWith("-"));
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
  if (verdict.valid) {
    emit({ valid: true, kind: verdict.envelope.kind, measurement: verdict.measurement }, 0);
  }

  // Not JSON at all is a different report from JSON that says the wrong thing.
  const notJson = verdict.issues.some((issue) => issue.rule === "not-json");
  emit({ valid: false, issues: verdict.issues }, notJson ? 3 : 1);
}

main();
