import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(
  new URL("../../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

test("EveryReleaseCarriesThem: a missing GitHub Release is created before assets are uploaded", () => {
  const publishJob = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  attach:"));
  const attachJob = workflow.slice(workflow.indexOf("\n  attach:"));
  const view = attachJob.indexOf('gh release view "$GITHUB_REF_NAME"');
  const create = attachJob.indexOf('gh release create "$GITHUB_REF_NAME"');
  const upload = attachJob.indexOf('gh release upload "$GITHUB_REF_NAME"');

  assert.ok(view >= 0, "the attach job must check whether the GitHub Release exists");
  assert.ok(create > view, "a missing GitHub Release must be created after the check");
  assert.ok(upload > create, "assets must be uploaded after the GitHub Release exists");
  assert.match(publishJob, /matched=""[\s\S]+matched="\$matched \$pkg"/);
  assert.match(publishJob, /if \[ -z "\$matched" \]; then[\s\S]+exit 1/);
  assert.doesNotMatch(
    publishJob,
    /if \[ -z "\$publish" \]; then[\s\S]+exit 1/,
    "an npm-complete rerun must continue to the release repair job",
  );
  assert.match(attachJob, /if ! gh release view[\s\S]+then[\s\S]+gh release create/);
  assert.match(attachJob, /gh release upload[^\n]+--clobber/);
});

// openlore: scenario=TheChannelComesFromTheVersion spec=update
test("PrereleasesAreNotWhatAnInstallationIsOffered: one derivation feeds both the npm channel and the release listing", () => {
  const publishJob = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  attach:"));
  const attachJob = workflow.slice(workflow.indexOf("\n  attach:"));

  // Publishing with no tag moves `latest`, which is the tag the update check reads —
  // so a prerelease published that way is offered to every existing installation.
  assert.doesNotMatch(publishJob, /npm publish --workspace "\$pkg"\s*$/m, "publishing with no dist-tag moves latest");
  assert.match(publishJob, /npm publish --workspace "\$pkg" --tag "\$channel"/);
  assert.match(publishJob, /channel=\$\(node scripts\/release-channel\.mjs/, "the channel must come from the version");

  // openlore: scenario=APrereleaseIsListedAsOne spec=update
  assert.match(attachJob, /channel=\$\(node scripts\/release-channel\.mjs/, "the same rule decides the listing");
  assert.match(attachJob, /if \[ "\$channel" != "latest" \]; then prerelease="--prerelease"; fi/);
  assert.match(attachJob, /gh release create[\s\S]{0,200}\$prerelease/);

  // The rule lives in a working copy, and this job had none.
  assert.match(attachJob, /actions\/checkout/, "the attach job must check out the rule it runs");

  // A rerun repairs an existing release and skips the create, so a flag passed only
  // at creation never reaches a release that is already marked wrongly.
  assert.match(attachJob, /gh release edit "\$GITHUB_REF_NAME" --prerelease --repo/);
  assert.match(attachJob, /gh release edit "\$GITHUB_REF_NAME" --prerelease=false --latest --repo/);
});

// openlore: scenario=AReleaseWithoutASectionIsRefused spec=update-changelog
test("AReleaseWithoutASectionIsRefused: the changelog is checked before npm, and becomes the release's notes", () => {
  const publishJob = workflow.slice(workflow.indexOf("\n  publish:"), workflow.indexOf("\n  attach:"));
  const attachJob = workflow.slice(workflow.indexOf("\n  attach:"));
  const gate = publishJob.indexOf('node scripts/changelog-section.mjs "${GITHUB_REF_NAME#v}"');
  assert.ok(gate >= 0, "the publish job must refuse a release the changelog does not describe");
  assert.ok(gate < publishJob.indexOf("npm publish"), "and refuse it before anything is published");
  assert.match(attachJob, /node scripts\/changelog-section\.mjs "\$\{GITHUB_REF_NAME#v\}" > release-notes\.md/);
  assert.match(attachJob, /gh release create[\s\S]+--notes-file release-notes\.md[\s\S]+--generate-notes/);
});
