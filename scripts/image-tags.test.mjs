import assert from "node:assert/strict";
import test from "node:test";
import { imageTags } from "./image-tags.mjs";

const IMAGE = "ghcr.io/LaurentFTech/pi-outpost-openwebui";

test("a stable release is pushed under its version and moves latest", () => {
  assert.deepEqual(imageTags("0.34.0", IMAGE), [
    "ghcr.io/laurentftech/pi-outpost-openwebui:0.34.0",
    "ghcr.io/laurentftech/pi-outpost-openwebui:latest",
  ]);
});

// openlore: scenario=APrereleaseDoesNotMoveLatest spec=openwebui-planning-server
test("APrereleaseDoesNotMoveLatest: a prerelease is pushed under its version only", () => {
  for (const version of ["0.34.0-beta.1", "0.34.0-rc.2", "0.34.0-0"]) {
    assert.deepEqual(imageTags(version, IMAGE), [`ghcr.io/laurentftech/pi-outpost-openwebui:${version}`], version);
  }
});

test("what the channel rule refuses, the tags refuse too", () => {
  assert.throws(() => imageTags("0.34.0-latest.1", IMAGE));
  assert.throws(() => imageTags("not-a-version", IMAGE));
  assert.throws(() => imageTags("0.34.0", `${IMAGE}:dev`));
});

// openlore: scenario=FullAppReleaseTagsFollowTheChannel spec=docker-python-deployment
test("FullAppReleaseTagsFollowTheChannel: version always, latest only for stable releases", () => {
  const image = "ghcr.io/LaurentFTech/pi-outpost";
  assert.deepEqual(imageTags("0.60.0", image), [
    "ghcr.io/laurentftech/pi-outpost:0.60.0", "ghcr.io/laurentftech/pi-outpost:latest",
  ]);
  for (const version of ["0.60.0-beta.1", "0.60.0-rc.2", "0.60.0-0"]) {
    assert.deepEqual(imageTags(version, image), [`ghcr.io/laurentftech/pi-outpost:${version}`]);
  }
  assert.throws(() => imageTags("0.60.0-latest.1", image));
});
