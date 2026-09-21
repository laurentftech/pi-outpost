/**
 * The provider stack probe: off by default, and when on, it reads the stack the
 * provider's catch is about to drop.
 *
 * The end-to-end case runs in a child process, because `--import` is the only slot early
 * enough to register a load hook — the module graph is loaded before any of the parent's
 * code evaluates. A fake module carrying pi-ai's exact catch line stands in for the SDK:
 * asserting against the real one would make this test a hostage to which provider file
 * the SDK happens to ship, and the line is the contract the hook matches on.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { isEnabled } from "../src/providerStackHook.mjs";

const run = promisify(execFile);
const HOOK = fileURLToPath(new URL("../src/providerStackHook.mjs", import.meta.url));

/** pi-ai's catch, reduced to the line the hook matches and a recursion to fall into. */
const FAKE_PROVIDER = `
const formatProviderError = (error) => String(error && error.message);
const normalizeProviderError = (error) => error;
export function stream() {
  const output = {};
  try {
    const recurse = () => recurse();
    recurse();
  } catch (error) {
    output.errorMessage = formatProviderError(normalizeProviderError(error));
  }
  return output;
}
`;

/** A provider module in a temp directory, plus the one-liner that drives it. */
async function fakeProvider() {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-stack-"));
  // path.join, never a "/" template: this suite runs on Windows too.
  const module = path.join(dir, "openai-completions.js");
  await writeFile(module, FAKE_PROVIDER);
  return { dir, module };
}

const driver = (module) =>
  `import(${JSON.stringify(module)}).then((m) => console.log("message: " + m.stream().errorMessage))`;

test("the flag decides, and only a value meaning yes turns it on", () => {
  for (const off of [undefined, "", "   ", "0", "false", "no", "off", "FALSE"]) {
    assert.equal(isEnabled(off), false, `${JSON.stringify(off)} does not arm the probe`);
  }
  for (const on of ["1", "true", "yes", "on", "please"]) {
    assert.equal(isEnabled(on), true, `${JSON.stringify(on)} arms it`);
  }
});

test("off by default: the module is imported and nothing is rewritten", async () => {
  const { module } = await fakeProvider();
  const { stdout, stderr } = await run(
    process.execPath,
    ["--import", HOOK, "-e", driver(module)],
    { env: { ...process.env, PI_OUTPOST_PROVIDER_STACK: "" } },
  );
  assert.match(stdout, /message: Maximum call stack size exceeded/, "the turn still fails the way it did");
  assert.doesNotMatch(stderr, /provider stack/, "no probe, no output");
  assert.doesNotMatch(stderr, /probe armed on /, "and nothing was rewritten");
});

test("armed: the stack the catch was about to drop reaches stderr", async () => {
  const { module } = await fakeProvider();
  const { stdout, stderr } = await run(
    process.execPath,
    ["--import", HOOK, "-e", driver(module)],
    { env: { ...process.env, PI_OUTPOST_PROVIDER_STACK: "1" } },
  );

  // The observed behaviour is unchanged: the probe reads, it does not intervene.
  assert.match(stdout, /message: Maximum call stack size exceeded/, "the turn fails exactly as before");

  assert.match(stderr, /provider stack probe armed on .*openai-completions\.js/, "it found the catch and said so");
  assert.match(stderr, /\[pi-outpost\] provider stack:/, "and printed a stack when the overflow came");
  assert.match(stderr, /RangeError: Maximum call stack size exceeded/, "a real one, with its error line");

  // The point of raising stackTraceLimit: ten frames of a recursion say only that
  // something repeated. The repeated frame, many times over, is the answer.
  const frames = stderr.split("\n").filter((line) => line.trim().startsWith("at "));
  assert.ok(frames.length > 50, `a deep trace, not V8's default ten (got ${frames.length})`);
  assert.ok(
    frames.filter((line) => line.includes("recurse")).length > 50,
    "and it names the function that recursed, which is what a real diagnosis reads",
  );
});

test("a catch the hook does not recognise arms nothing, and says nothing false", async () => {
  const { dir } = await fakeProvider();
  // The same shape with the assignment rewritten — what a future SDK refactor looks like.
  const moved = path.join(dir, "moved.js");
  await writeFile(
    moved,
    `export function stream() {
       const output = {};
       try { const recurse = () => recurse(); recurse(); }
       catch (error) { output.errorMessage = String(error && error.message); }
       return output;
     }`,
  );
  const { stdout, stderr } = await run(
    process.execPath,
    ["--import", HOOK, "-e", driver(moved)],
    { env: { ...process.env, PI_OUTPOST_PROVIDER_STACK: "1" } },
  );
  assert.match(stdout, /message: Maximum call stack size exceeded/, "the module still runs");
  assert.doesNotMatch(stderr, /probe armed on /, "nothing claims to have been armed");
  assert.match(stderr, /the SDK's catch has moved/, "and the startup line already warned this could happen");
});
