import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { entriesBetween, markerPath, parseChangelog, recordRunningVersion } from "../src/changelog.ts";
import { cachePath } from "../src/update.ts";

const CHANGELOG = [
  "# Changelog",
  "",
  "Preamble, before any release.",
  "",
  "## [0.3.0] - 2026-03-01",
  "",
  "### Added",
  "",
  "- three",
  "",
  "## Not a release",
  "",
  "- belongs to nothing",
  "",
  "## [0.3.0-beta.1]",
  "",
  "- three, early",
  "",
  "## [0.2.0] - 2026-02-01",
  "",
  "- two",
  "",
  "## [0.1.0] - 2026-01-01",
  "",
  "- one",
  "",
].join("\n");

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));
function agentDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pi-outpost-changelog-"));
  dirs.push(dir);
  return dir;
}
const writeMarker = (dir: string, marker: object) => writeFileSync(markerPath(dir), JSON.stringify(marker));
const readMarker = (dir: string) => JSON.parse(readFileSync(markerPath(dir), "utf8")) as { version: string; updatedFrom?: string };
const run = (dir: string, version: string, changelog = CHANGELOG) => recordRunningVersion({ version, changelog, agentDir: dir });

describe("parseChangelog", () => {
  test("keeps release sections only, with their dates and bodies", () => {
    const entries = parseChangelog(CHANGELOG);
    assert.deepEqual(
      entries.map((entry) => entry.version),
      ["0.3.0", "0.3.0-beta.1", "0.2.0", "0.1.0"],
    );
    assert.equal(entries[0].date, "2026-03-01");
    assert.equal(entries[0].markdown, "### Added\n\n- three");
    assert.equal(entries[1].date, undefined);
    assert.equal(
      entries.some((entry) => entry.markdown.includes("belongs to nothing") || entry.markdown.includes("Preamble")),
      false,
    );
  });

  test("reads a file checked out with CRLF line endings", () => {
    const entries = parseChangelog(CHANGELOG.replaceAll("\n", "\r\n"));
    assert.equal(entries[0].markdown, "### Added\n\n- three");
  });

  test("the CHANGELOG.md that ships parses, and names each release once", () => {
    const shipped = parseChangelog(readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8"));
    assert.ok(shipped.length > 0);
    assert.equal(new Set(shipped.map((entry) => entry.version)).size, shipped.length);
    assert.ok(shipped.every((entry) => entry.markdown.length > 0));
  });
});

describe("entriesBetween", () => {
  test("is exclusive of the old version, inclusive of the new, newest first", () => {
    const entries = parseChangelog(CHANGELOG);
    assert.deepEqual(
      entriesBetween(entries, "0.1.0", "0.3.0").map((entry) => entry.version),
      ["0.3.0", "0.3.0-beta.1", "0.2.0"],
    );
    assert.deepEqual(
      entriesBetween(entries, "0.1.0", "0.2.0").map((entry) => entry.version),
      ["0.2.0"],
    );
  });
});

describe("recordRunningVersion", () => {
  // openlore: scenario=WhatChangedIsShownAfterAnUpdate spec=update-changelog
  test("WhatChangedIsShownAfterAnUpdate: an update names both versions and the sections between them", async () => {
    const dir = agentDir();
    writeMarker(dir, { version: "0.1.0" });
    const changes = await run(dir, "0.3.0");
    assert.equal(changes?.from, "0.1.0");
    assert.equal(changes?.to, "0.3.0");
    assert.deepEqual(
      changes?.entries.map((entry) => entry.version),
      ["0.3.0", "0.3.0-beta.1", "0.2.0"],
    );
    assert.equal(changes?.releaseNotes, "https://github.com/laurentftech/pi-outpost/releases/tag/v0.3.0");
    assert.deepEqual(readMarker(dir), { version: "0.3.0", updatedFrom: "0.1.0" });
  });

  // openlore: scenario=TheNewsSurvivesARestart spec=update-changelog
  test("TheNewsSurvivesARestart: the same version running again still says what its update changed", async () => {
    const dir = agentDir();
    writeMarker(dir, { version: "0.1.0" });
    await run(dir, "0.2.0");
    const again = await run(dir, "0.2.0");
    assert.equal(again?.from, "0.1.0");
    assert.deepEqual(
      again?.entries.map((entry) => entry.version),
      ["0.2.0"],
    );
  });

  // openlore: scenario=NothingToSayWithoutAnUpdate spec=update-changelog
  test("NothingToSayWithoutAnUpdate: a first run, a downgrade and a source checkout say nothing", async () => {
    const first = agentDir();
    assert.equal(await run(first, "0.3.0"), undefined);
    assert.deepEqual(readMarker(first), { version: "0.3.0" });
    // ...and the run after it has nothing to say either
    assert.equal(await run(first, "0.3.0"), undefined);

    const down = agentDir();
    writeMarker(down, { version: "0.3.0", updatedFrom: "0.2.0" });
    assert.equal(await run(down, "0.2.0"), undefined);
    assert.deepEqual(readMarker(down), { version: "0.2.0" });

    const dev = agentDir();
    assert.equal(await run(dev, "dev"), undefined);
    assert.throws(() => readMarker(dev), "a source checkout records nothing");
  });

  // openlore: scenario=AnInstallationOlderThanTheMarkerIsToldAboutThisRelease spec=update-changelog
  test("AnInstallationOlderThanTheMarkerIsToldAboutThisRelease: the update check's cache stands for an earlier run", async () => {
    const dir = agentDir();
    writeFileSync(cachePath(dir), JSON.stringify({ latest: "0.3.0", checkedAt: 0 }));
    const changes = await run(dir, "0.3.0");
    // The release before 0.3.0 in the file is its beta: only 0.3.0's own section is new
    assert.equal(changes?.from, "0.3.0-beta.1");
    assert.deepEqual(
      changes?.entries.map((entry) => entry.version),
      ["0.3.0"],
    );
    assert.deepEqual(readMarker(dir), { version: "0.3.0", updatedFrom: "0.3.0-beta.1" });
  });

  test("an update the changelog says nothing about is still announced, with no sections", async () => {
    const dir = agentDir();
    writeMarker(dir, { version: "0.3.0" });
    const changes = await run(dir, "0.4.0");
    assert.equal(changes?.from, "0.3.0");
    assert.deepEqual(changes?.entries, []);
  });

  test("an unreadable marker counts as none", async () => {
    const dir = agentDir();
    writeFileSync(markerPath(dir), "{not json");
    assert.equal(await run(dir, "0.3.0"), undefined);
    assert.deepEqual(readMarker(dir), { version: "0.3.0" });
  });
});
