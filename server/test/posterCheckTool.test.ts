/**
 * poster_check: the agent checks a poster it wrote (poster-files, TheAgentChecksThePostersItWrites),
 * the files its frames name opened as the editor opens them. What the text alone says is tested
 * in posters/test/check.test.ts.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { pageOf } from "@pi-outpost/posters/format";
import { createPosterCheckToolDefinition } from "../src/posterCheckTool.ts";
import { createPosterPicturesToolDefinition } from "../src/posterPicturesTool.ts";

const DIAGRAM = `<mxfile><diagram name="Overview"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Battery" vertex="1" parent="1"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>`;
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 40"><rect width="90" height="40"/></svg>`;
const poster = (html: string) => pageOf("Car", { html, css: ".p { width: 100%; }", format: "slide-16:9" });

let root: string;
let outside: string;
before(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), "poster-check-")));
  outside = await realpath(await mkdtemp(path.join(tmpdir(), "poster-check-outside-")));
  await mkdir(path.join(root, "posters"));
  await mkdir(path.join(root, "docs"));
  await mkdir(path.join(root, "figures"));
  await writeFile(path.join(root, "docs", "architecture.drawio"), DIAGRAM);
  await writeFile(path.join(root, "docs", "broken.drawio"), "<mxfile><diagram");
  await writeFile(path.join(root, "figures", "car.svg"), SVG);
  await writeFile(path.join(outside, "secret.svg"), SVG);
  await writeFile(
    path.join(root, "posters", "good.poster.html"),
    poster(`<img data-poster-picture="architecture" data-drawio="../docs/architecture.drawio" data-drawio-page="Overview" alt="Architecture"><img data-picture-file="/figures/car.svg" alt="Car"><img data-drawio="../docs/architecture.drawio" data-drawio-page="Page 2" alt="Second"><img data-drawio="../docs/architecture.drawio" data-drawio-page="1" alt="First">`),
  );
  await writeFile(
    path.join(root, "posters", "missing.poster.html"),
    poster(
      [
        `<img data-poster-picture="gone" data-drawio="../docs/gone.drawio" alt="Gone">`,
        `<img data-drawio="../docs/architecture.drawio" data-drawio-page="Wiring" alt="Wiring">`,
        `<img data-picture-file="../figures/none.svg" alt="None">`,
        `<img data-picture-file="${path.relative(path.join(root, "posters"), path.join(outside, "secret.svg")).split(path.sep).join("/")}" alt="Secret">`,
        `<img data-drawio="/docs/broken.drawio" alt="Broken">`,
        // Filled: what it names no longer matters.
        `<img data-picture-file="../figures/none.png" src="data:image/png;base64,AA" alt="Kept">`,
      ].join(""),
    ),
  );
  await writeFile(path.join(root, "posters", "page.poster.html"), `<!DOCTYPE html><html><head><style>body{}</style></head><body><img src="../docs/architecture.drawio"><img src="../figures/car.svg"></body></html>`);
  await writeFile(path.join(root, "posters", "fetched.poster.html"), poster(`<img src="../docs/architecture.drawio" alt="a"><img src="../figures/car.svg" alt="b">`));
  await writeFile(path.join(outside, "elsewhere.poster.html"), poster("<p>x</p>"));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

type Result = { content: Array<{ type: string; text?: string }>; isError?: boolean };
async function check(target: string): Promise<Result> {
  const tool = createPosterCheckToolDefinition({ cwd: root, allowedRoots: [root] });
  return (await tool.execute("call", { path: target } as never, undefined, undefined, undefined as never)) as unknown as Result;
}

// openlore: scenario=AWellFormedPosterPasses spec=poster-files
test("AWellFormedPosterPasses: frames naming a diagram page, by name, number or Page N, and a picture from the root", async () => {
  const result = await check("posters/good.poster.html");
  assert.equal(result.isError, undefined);
  assert.equal(
    result.content[0]!.text,
    "`posters/good.poster.html` is a valid poster with no defect found: format slide-16:9; 4 frames the editor fills when the poster opens (diagram ../docs/architecture.drawio page Overview, picture /figures/car.svg, diagram ../docs/architecture.drawio page Page 2, diagram ../docs/architecture.drawio page 1). Tell the person to open it and save it to keep the pictures.",
  );
});

// openlore: scenario=AFrameNamingSomethingMissingIsNamed spec=poster-files
test("AFrameNamingSomethingMissingIsNamed: a missing diagram, page and picture, a file outside the zone, a broken diagram", async () => {
  const text = (await check("posters/missing.poster.html")).content[0]!.text!;
  assert.match(text, /would not give the person what you meant: 5 errors and 0 warnings/);
  assert.match(text, /- error: the frame "gone" \(\.\.\/docs\/gone\.drawio\): no such file from the poster's directory/);
  assert.match(text, /- error: the frame "Wiring" \(\.\.\/docs\/architecture\.drawio\): the diagram has no page "Wiring"; its pages are "Overview", "Page-2"/);
  assert.match(text, /- error: the frame "None" \(\.\.\/figures\/none\.svg\): no such file/);
  assert.match(text, /- error: the frame "Secret" \(.*secret\.svg\) names a file outside the workspace, which the editor cannot read\./);
  assert.match(text, /- error: the frame "Broken" \(\/docs\/broken\.drawio\): draw\.io cannot open it: .*Run drawio_check on it\./);
  assert.doesNotMatch(text, /Kept/);
  assert.match(text, /Fix the errors, then run poster_check again\.$/);
});

// openlore: scenario=APageThatIsNotAPosterIsNamed spec=poster-files
test("APageThatIsNotAPosterIsNamed: the page Gemini wrote", async () => {
  const text = (await check("posters/page.poster.html")).content[0]!.text!;
  assert.match(text, /1 error and 0 warnings/);
  assert.match(text, /this is not a poster: it has no <meta name="poster-format">.*write it from the skeleton in the posters skill/);
});

// openlore: scenario=AFileTheEditorWouldNotDrawIsNamed spec=poster-files
test("AFileTheEditorWouldNotDrawIsNamed: through the tool, with the frame to write for each file", async () => {
  const text = (await check("posters/fetched.poster.html")).content[0]!.text!;
  assert.match(text, /2 errors/);
  assert.match(text, /data-drawio="\.\.\/docs\/architecture\.drawio"/);
  assert.match(text, /data-picture-file="\.\.\/figures\/car\.svg"/);
});

test("Refused: not a poster file, no such file, outside the read zone", async () => {
  assert.match((await check("docs/architecture.drawio")).content[0]!.text!, /is not a poster: give a \.poster\.html file/);
  assert.equal((await check("posters/none.poster.html")).isError, true);
  await assert.rejects(check(path.join(outside, "elsewhere.poster.html")), /Access denied/);
});

test("The guideline asks for a check after every write or edit of a poster", () => {
  const tool = createPosterCheckToolDefinition({ cwd: root, allowedRoots: [root] });
  assert.equal(tool.name, "poster_check");
  assert.ok(tool.promptGuidelines?.some((line) => /After every write or edit of a \.poster\.html file, run poster_check/.test(line)));
});

// openlore: scenario=PosterPicturesNamesANonPoster spec=poster-elements
test("PosterPicturesNamesANonPoster: poster_pictures refuses a page that is no poster, naming the marker", async () => {
  const tool = createPosterPicturesToolDefinition({ cwd: root, allowedRoots: [root] });
  const result = (await tool.execute("call", { path: "posters/page.poster.html" } as never, undefined, undefined, undefined as never)) as unknown as Result;
  assert.equal(result.isError, true);
  assert.match(result.content[0]!.text!, /cannot be looked at: this is not a poster: it has no <meta name="poster-format">.*Run poster_check on it/);
  assert.doesNotMatch(result.content[0]!.text!, /frames, if any, are empty/);
});
