#!/usr/bin/env node
/**
 * Generates the browser's schema check from the committed schema.
 *
 * The browser needs a verdict, not a diagnosis: everyone who has to *act* on a
 * refusal — a producer, the agent correcting a proposal, an operator calibrating a
 * limit — reads it from the command-line interface or the server, both of which
 * run in Node and carry the full validator. What the browser decides is only
 * whether to render or fall back, and for that a boolean is enough.
 *
 * Generating it rather than hand-writing it is the whole point: a check written by
 * hand from the schema is a second contract that drifts. This one is derived, and
 * `structuredExchangeGeneratedCheck.test.ts` regenerates and compares, so a schema
 * edit that forgets this step fails the build instead of shipping a stale check.
 *
 *   node --import tsx/esm shared/scripts/generate-structured-exchange-check.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Code } from "typebox/compile";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * One generated check per published version, because the browser dispatches too:
 * a document is judged by the contract it declares, and a build that shipped only
 * the newest check would quietly re-judge every version 1 document by version 2's
 * rules — accepting fields version 1 refuses.
 */
export const GENERATED_CHECKS = [
  {
    version: "1",
    schema: path.resolve(HERE, "../schemas/structured-exchange-1.json"),
    output: path.resolve(HERE, "../src/generated/structuredExchangeCheck.ts"),
  },
  {
    version: "2",
    schema: path.resolve(HERE, "../schemas/structured-exchange-2.json"),
    output: path.resolve(HERE, "../src/generated/structuredExchangeCheck2.ts"),
  },
];

const header = (version) => `/**
 * GENERATED from shared/schemas/structured-exchange-${version}.json — do not edit.
 *
 * Regenerate with:
 *   node --import tsx/esm shared/scripts/generate-structured-exchange-check.mjs
 *
 * A boolean check of the published schema, small enough to ship to the browser.
 * Diagnostics live in the Node-side validator; see structuredExchangeSchemaNode.ts.
 */
/* eslint-disable */
// @ts-nocheck
`;

/**
 * The compiler hoists the `additionalProperties` patterns out as external
 * variables, so the generated module has to be handed them before its check will
 * run. They are plain regular expressions; emitting their source keeps the
 * generated file self-contained, which is what makes it a drop-in for the
 * browser.
 */
function externalsLiteral(variables) {
  const sources = variables.map((variable) => {
    if (!(variable instanceof RegExp)) {
      throw new Error(`unexpected external of type ${Object.prototype.toString.call(variable)}`);
    }
    return `  new RegExp(${JSON.stringify(variable.source)}, ${JSON.stringify(variable.flags)}),`;
  });
  return `\nSetExternal({ variables: [\n${sources.join("\n")}\n] })\n`;
}

export function generate(version = "1") {
  const target = GENERATED_CHECKS.find((candidate) => candidate.version === version);
  if (target === undefined) throw new Error(`no generated check is declared for version ${version}`);
  const schema = JSON.parse(readFileSync(target.schema, "utf8"));
  const compiled = Code(schema);
  return `${header(version)}${compiled.Code}\n${externalsLiteral(compiled.External.variables)}`;
}

export const GENERATED_CHECK_PATH = GENERATED_CHECKS[0].output;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const { version, output } of GENERATED_CHECKS) {
    writeFileSync(output, generate(version));
    console.log(`wrote ${path.relative(process.cwd(), output)}`);
  }
}
