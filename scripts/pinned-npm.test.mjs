// The npm the project builds with is installed from tools/npm/package-lock.json, so its
// tarball is checked against an integrity hash (docs/development.md#the-pinned-npm). These
// tests keep that the only way npm is installed, and keep its copies in step.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const json = (path) => JSON.parse(read(path));

test("the pinned npm is the version package.json asks for", () => {
  const pinned = json("tools/npm/package.json").dependencies.npm;
  assert.equal(json("package.json").packageManager, `npm@${pinned}`);
  const locked = json("tools/npm/package-lock.json").packages["node_modules/npm"];
  assert.equal(locked.version, pinned);
  assert.match(locked.integrity, /^sha512-/);
});

test("the Docker recipe's copy of the pinned npm matches tools/npm", () => {
  // deploy/docker is built with its own directory as the context, so it cannot read tools/.
  for (const file of ["package.json", "package-lock.json", ".npmrc"]) {
    assert.equal(read(`deploy/docker/npm/${file}`), read(`tools/npm/${file}`), file);
  }
});

test("no workflow or Dockerfile installs npm by version instead", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0");
  const offenders = tracked
    .filter((path) => /^\.github\/(workflows|actions)\/|(^|\/)Dockerfile$/.test(path))
    .filter((path) => /npm install (-g|--global) npm@/.test(read(path)));
  assert.deepEqual(offenders, []);
});
