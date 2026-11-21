/**
 * The token a server generates when none is configured (`auth` › OptionalSharedToken).
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { GENERATED_TOKEN_FILE, generatedToken } from "../src/serverToken.ts";

const run = promisify(execFile);
const dirs: string[] = [];
const fresh = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "outpost-token-"));
  dirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("generated token", () => {
  test("NoTokenConfigured: made once, kept in the agent directory, the same on the next start", () => {
    const agentDir = path.join(fresh(), "agent");
    const first = generatedToken(agentDir);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(readFileSync(path.join(agentDir, GENERATED_TOKEN_FILE), "utf8").trim(), first);
    assert.equal(generatedToken(agentDir), first);
    if (process.platform !== "win32") assert.equal(statSync(path.join(agentDir, GENERATED_TOKEN_FILE)).mode & 0o777, 0o600);
  });

  test("servers starting together agree on one token", async () => {
    const agentDir = fresh();
    const module = pathToFileURL(fileURLToPath(new URL("../src/serverToken.ts", import.meta.url))).href;
    const script = `const { generatedToken } = await import(${JSON.stringify(module)}); process.stdout.write(generatedToken(${JSON.stringify(agentDir)}));`;
    const outputs = await Promise.all(
      Array.from({ length: 6 }, () => run(process.execPath, ["--import", "tsx/esm", "--input-type=module", "-e", script])),
    );
    const tokens = new Set(outputs.map((output) => output.stdout));
    assert.equal(tokens.size, 1);
    assert.equal(readFileSync(path.join(agentDir, GENERATED_TOKEN_FILE), "utf8").trim(), [...tokens][0]);
  });

  test("deleting the file rotates the token", () => {
    const agentDir = fresh();
    const first = generatedToken(agentDir);
    rmSync(path.join(agentDir, GENERATED_TOKEN_FILE));
    assert.notEqual(generatedToken(agentDir), first);
  });

  test("an empty file is refused, not taken for a token", () => {
    const agentDir = fresh();
    writeFileSync(path.join(agentDir, GENERATED_TOKEN_FILE), "  \n");
    assert.throws(() => generatedToken(agentDir), /holds no token/);
  });
});
