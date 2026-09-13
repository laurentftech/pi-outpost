/**
 * No test hands NODE_V8_COVERAGE to a child `node` process.
 *
 * A child that has it writes a coverage file the coverage run then parses, and a
 * truncated one fails a run whose tests all passed ("failed to parse coverage file …
 * Unterminated string in JSON"). A pdf.js child alone wrote ten megabytes of it.
 *
 * The rule has one trap, and the repository fell into it: deleting the key does
 * nothing. node's child_process copies the parent's NODE_V8_COVERAGE into any child
 * environment that does not name it, so `delete env.NODE_V8_COVERAGE`, a destructured
 * `{ NODE_V8_COVERAGE: _sink, ...rest }` and an `env: { PATH }` all hand the sink back.
 * Only an explicit value survives: empty turns coverage off in the child, a directory is a
 * sink the test chose. So every launch of `process.execPath` under server/test is read here,
 * and each must name it — through `envWithoutCoverageSink`, `NODE_V8_COVERAGE: ""`, or a
 * deliberate sink of its own.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { envWithoutCoverageSink } from "./childEnv.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));

/** Each launch of this node binary in a test source: the file, its line, and the call's text. */
function launches(): { file: string; line: number; call: string }[] {
  const found: { file: string; line: number; call: string }[] = [];
  for (const file of readdirSync(HERE).filter((name) => /\.(ts|mjs)$/.test(name) && name !== SELF)) {
    const text = readFileSync(path.join(HERE, file), "utf8");
    for (const match of text.matchAll(/\b(?:execFile|execFileSync|spawn|spawnSync|fork|promisify\(execFile\))\(\s*process\.execPath\b/g)) {
      const line = text.slice(0, match.index).split("\n").length;
      // The call's arguments: far enough to reach its options object.
      found.push({ file, line, call: text.slice(match.index, match.index + 700) });
    }
  }
  return found;
}

/** How a launch blanks the sink for its child, or undefined when it does not. */
function guard(call: string, source: string): string | undefined {
  if (/envWithoutCoverageSink\(/.test(call)) return "envWithoutCoverageSink";
  // Named, the parent value is not copied: blank to turn coverage off, or a deliberate sink.
  if (/NODE_V8_COVERAGE:\s*""/.test(call)) return "blanks it inline";
  if (/NODE_V8_COVERAGE:\s*[A-Za-z_$]/.test(call)) return "names its own sink";
  // An environment held in a variable, named or spread: the file must build it blanked.
  const variable = /env:\s*\{\s*\.\.\.([A-Za-z_$][\w$]*)/.exec(call)?.[1] ?? /env:\s*([A-Za-z_$][\w$]*)\b/.exec(call)?.[1] ?? (/\benv\s*[,}]/.test(call) ? "env" : undefined);
  if (variable === undefined) return undefined;
  const blanked = new RegExp(
    `\\b${variable}\\b[^;]*=\\s*(?:envWithoutCoverageSink\\(|\\{[^;]*NODE_V8_COVERAGE:\\s*"")|\\b${variable}\\.NODE_V8_COVERAGE\\s*=\\s*""|\\.\\.\\.${variable}\\s*\\}\\s*=\\s*envWithoutCoverageSink\\(`,
  );
  return blanked.test(source) ? `builds ${variable} blanked` : undefined;
}

describe("children launched by the server tests", () => {
  const found = launches();

  test("are found at all, so this cannot pass by reading nothing", () => {
    assert.ok(found.length >= 20, `only ${found.length} launches found`);
  });

  test("never inherit NODE_V8_COVERAGE", () => {
    const leaking = found
      .filter(({ call, file }) => guard(call, readFileSync(path.join(HERE, file), "utf8")) === undefined)
      .map(({ file, line }) => `${file}:${line}`);
    assert.deepEqual(leaking, [], 'these launches hand NODE_V8_COVERAGE to their child — pass envWithoutCoverageSink() from ./childEnv.mjs, or NODE_V8_COVERAGE: ""');
  });

  test("the guard refuses the forms that look safe and are not", () => {
    const source = "";
    assert.equal(guard(`execFile(process.execPath, ["x.mjs"], { cwd: "/tmp" })`, source), undefined);
    assert.equal(guard(`execFile(process.execPath, ["x.mjs"], { env: { ...process.env, A: "1" } })`, source), undefined);
    assert.equal(guard(`execFile(process.execPath, ["x.mjs"], { env: { PATH: process.env.PATH } })`, source), undefined);
    assert.equal(guard(`spawn(process.execPath, argv, { env })`, `const env = { ...process.env };\ndelete env.NODE_V8_COVERAGE;`), undefined);
    assert.equal(guard(`execFile(process.execPath, ["x.mjs"], { env: envWithoutCoverageSink() })`, source), "envWithoutCoverageSink");
    assert.equal(guard(`spawn(process.execPath, argv, { env })`, `const env = envWithoutCoverageSink({ A: "1" });`), "builds env blanked");
  });
});

describe("the rule the guard enforces", () => {
  const probe = ["--input-type=module", "--eval", "process.stdout.write(JSON.stringify(process.env.NODE_V8_COVERAGE ?? null))"];
  // A real sink: the probes that keep it do write coverage there, so it is a throwaway
  // directory outside the repository, removed afterwards.
  const sink = mkdtempSync(path.join(tmpdir(), "pi-outpost-coverage-sink-"));
  const withSink = { ...process.env, NODE_V8_COVERAGE: sink };
  after(() => rmSync(sink, { recursive: true, force: true }));

  test("a deleted sink comes back in the child, and a blanked one does not", () => {
    // Asked of node itself, from a parent that has the sink: what the child is handed.
    const parent = (childEnv: string) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          ["--input-type=module", "--eval", `import { execFileSync } from "node:child_process"; process.stdout.write(execFileSync(process.execPath, ${JSON.stringify(probe)}, { env: ${childEnv}, encoding: "utf8" }))`],
          { env: withSink, encoding: "utf8" },
        ),
      );
    assert.equal(parent(`(() => { const e = { ...process.env }; delete e.NODE_V8_COVERAGE; return e; })()`), withSink.NODE_V8_COVERAGE, "node no longer re-injects a deleted sink — the rule can relax");
    assert.equal(parent(`{ ...process.env, NODE_V8_COVERAGE: "" }`), "");
  });

  test("envWithoutCoverageSink blanks it and keeps what it is given", () => {
    const env = envWithoutCoverageSink({ EXTRA: "1", NODE_V8_COVERAGE: "/somewhere" });
    assert.equal(env.NODE_V8_COVERAGE, "");
    assert.equal(env.EXTRA, "1");
  });
});
