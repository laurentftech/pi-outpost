import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sectionFor } from "./changelog-section.mjs";

const TEXT = ["# Changelog", "", "## [0.2.0] - 2026-02-01", "", "- two", "", "## [0.1.0]", "", "- one", ""].join("\n");

test("prints one release's body, without its heading or the next section", () => {
  assert.equal(sectionFor(TEXT, "0.2.0"), "- two");
  assert.equal(sectionFor(TEXT, "0.1.0"), "- one");
  assert.equal(sectionFor(TEXT.replaceAll("\n", "\r\n"), "0.2.0"), "- two");
});

// openlore: scenario=AReleaseWithoutASectionIsRefused spec=update-changelog
test("AReleaseWithoutASectionIsRefused: a missing, empty or doubled section is refused", () => {
  assert.throws(() => sectionFor(TEXT, "0.3.0"), /no "## \[0\.3\.0\]/);
  assert.throws(() => sectionFor("## [0.3.0] - 2026-03-01\n\n## [0.2.0]\n- two\n", "0.3.0"), /empty/);
  assert.throws(() => sectionFor(`${TEXT}\n## [0.2.0]\n- again\n`, "0.2.0"), /two sections/);
});

// openlore: scenario=AReleaseWithoutASectionIsRefused spec=update-changelog
test("the version the packages are at has its section, so a bump cannot land without one", () => {
  const version = JSON.parse(readFileSync(new URL("../cli/package.json", import.meta.url), "utf8")).version;
  const text = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.ok(sectionFor(text, version).length > 0);
});
