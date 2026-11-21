/**
 * `server/scripts/dev-config.mjs`: the dev servers run from an untracked copy of their committed
 * configuration, so what the server writes back (open projects, Settings) never shows in git.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { prepareDevConfig } from "../scripts/dev-config.mjs";

async function inDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-outpost-devconfig-"));
  try {
    return await fn(path.join(dir, "pi-outpost.config.dev.json"), path.join(dir, "pi-outpost.config.dev.local.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const COMMITTED = '{\n  "cwd": ".",\n  "server": { "port": 3142 }\n}\n';

test("a missing copy is the committed file, byte for byte", async () => {
  await inDir(async (committed, local) => {
    await writeFile(committed, COMMITTED);
    assert.equal(prepareDevConfig(committed, local), "created");
    assert.equal(await readFile(local, "utf8"), COMMITTED);
  });
});

test("what the server wrote to the copy is kept while the committed file has not changed, and the committed file is never written", async () => {
  await inDir(async (committed, local) => {
    await writeFile(committed, COMMITTED);
    prepareDevConfig(committed, local);
    const written = '{ "cwd": ".", "server": { "port": 3142 }, "openProjects": ["C:\\\\Users\\\\me\\\\sandbox"] }\n';
    await writeFile(local, written);
    const past = new Date(Date.now() - 60_000);
    await utimes(committed, past, past);
    assert.equal(prepareDevConfig(committed, local), "kept");
    assert.equal(await readFile(local, "utf8"), written);
    assert.equal(await readFile(committed, "utf8"), COMMITTED);
  });
});

test("a newer committed file wins for its own keys; the keys only the copy has are kept", async () => {
  await inDir(async (committed, local) => {
    await writeFile(local, '{ "cwd": ".", "server": { "port": 9999 }, "openProjects": ["/home/me/p"] }\n');
    const past = new Date(Date.now() - 60_000);
    await utimes(local, past, past);
    await writeFile(committed, '{ "cwd": ".", "server": { "port": 3142 }, "sandbox": { "allowBash": true } }\n');
    assert.equal(prepareDevConfig(committed, local), "refreshed");
    assert.deepEqual(JSON.parse(await readFile(local, "utf8")), {
      cwd: ".",
      server: { port: 3142 },
      sandbox: { allowBash: true },
      openProjects: ["/home/me/p"],
    });
  });
});

test("an unreadable copy is replaced by a newer committed file, nothing kept", async () => {
  await inDir(async (committed, local) => {
    await writeFile(local, "{ not json");
    const past = new Date(Date.now() - 60_000);
    await utimes(local, past, past);
    await writeFile(committed, COMMITTED);
    assert.equal(prepareDevConfig(committed, local), "refreshed");
    assert.deepEqual(JSON.parse(await readFile(local, "utf8")), JSON.parse(COMMITTED));
  });
});
