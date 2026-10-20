import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { after, describe, test } from "node:test";
import { checkDrawio, describeDrawioReport, DrawioReadError, inflatePage, MAX_INFLATED_PAGE_BYTES, readDrawio } from "../src/drawio.ts";
import { createDrawioCheckToolDefinition } from "../src/drawioTool.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "drawio");

/** A page as draw.io compresses it: base64 of the raw-deflated, URI-encoded model. */
const compress = (model: string) => deflateRawSync(Buffer.from(encodeURIComponent(model), "latin1")).toString("base64");

const model = (cells: string) => `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`;
const file = (...pages: [string, string][]) =>
  `<mxfile host="test">${pages.map(([name, body]) => `<diagram id="${name}" name="${name}">${body}</diagram>`).join("")}</mxfile>`;
const box = (id: string, x: number, y: number, label = id, parent = "1", size = "width=\"120\" height=\"60\"") =>
  `<mxCell id="${id}" value="${label}" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${y}" ${size} as="geometry"/></mxCell>`;
const link = (id: string, source: string, target: string) =>
  `<mxCell id="${id}" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry"/></mxCell>`;

const CLEAN = file(["Overview", model(box("a", 40, 40) + box("b", 240, 40) + link("e", "a", "b"))]);

const errorsOf = (xml: string) => checkDrawio(xml).issues.filter((issue) => issue.severity === "error");
const warningsOf = (xml: string) => checkDrawio(xml).issues.filter((issue) => issue.severity === "warning");

describe("checkDrawio", () => {
  // openlore: scenario=ACleanDiagramPasses spec=drawio-diagrams
  test("ACleanDiagramPasses: no issue, and the pages, shapes and connectors counted", () => {
    const report = checkDrawio(CLEAN);
    assert.deepEqual(report.issues, []);
    assert.deepEqual(report.pages, [{ name: "Overview", shapes: 2, connectors: 1 }]);
    assert.equal(describeDrawioReport("d.drawio", report), '`d.drawio` is a valid draw.io diagram with no defect found: 1 page ("Overview"), 2 shapes, 1 connector.');
  });

  // openlore: scenario=TheCheckerReportsDefects spec=drawio-diagrams
  test("TheCheckerReportsDefects: each defect is an error naming its cell", () => {
    const broken = file([
      "Broken",
      model(
        box("a", 40, 40) +
          box("a", 240, 40, "again") + // duplicate id
          box("orphan", 40, 200, "orphan", "nowhere") + // parent missing
          link("to-ghost", "a", "ghost") + // end missing
          `<mxCell id="loose" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"/></mxCell>` + // attached to nothing at its end
          `<mxCell id="sizeless" value="no geometry" vertex="1" parent="1"/>` +
          `<mxCell id="nan" vertex="1" parent="1"><mxGeometry x="ten" y="0" width="10" height="10" as="geometry"/></mxCell>` +
          box("negative", 400, 40, "negative", "1", 'width="-20" height="40"') +
          `<mxCell id="stray" vertex="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell>`, // no parent
      ),
    ]);
    const errors = errorsOf(broken);
    const byCell = (id: string) => errors.filter((issue) => issue.cells.includes(id)).map((issue) => issue.message);
    assert.match(byCell("a").join(), /the id "a" is used by more than one cell/);
    assert.match(byCell("orphan").join(), /belongs to "nowhere", which does not exist/);
    assert.match(byCell("to-ghost").join(), /end on "ghost", which does not exist/);
    assert.match(byCell("loose").join(), /attached to nothing at its end/);
    assert.match(byCell("sizeless").join(), /has no <mxGeometry/);
    assert.match(byCell("nan").join(), /not numbers: x="ten"/);
    assert.match(byCell("negative").join(), /negative size/);
    assert.match(byCell("stray").join(), /has no parent/);
    assert.equal(errors.every((issue) => issue.page === "Broken"), true);
    assert.match(describeDrawioReport("b.drawio", checkDrawio(broken)), /^`b\.drawio` would not open as intended: 8 errors and 0 warnings/);
  });

  test("a connector may leave an end free with a point instead of a shape", () => {
    const free = file(["P", model(box("a", 40, 40) + `<mxCell id="e" edge="1" parent="1" source="a"><mxGeometry relative="1" as="geometry"><mxPoint x="300" y="70" as="targetPoint"/></mxGeometry></mxCell>`)]);
    assert.deepEqual(errorsOf(free), []);
  });

  test("a line is drawn with one side at zero; only 0 × 0 is said to show nothing", () => {
    assert.deepEqual(checkDrawio(file(["P", model(box("line", 40, 40, "", "1", 'width="200" height="0"'))])).issues, []);
    assert.match(warningsOf(file(["P", model(box("dot", 40, 40, "", "1", 'width="0" height="0"'))]))[0].message, /0 × 0/);
  });

  // openlore: scenario=TheCheckerWarnsAboutLayout spec=drawio-diagrams
  test("TheCheckerWarnsAboutLayout: labelled boxes overlapping, and a shape outside its lane", () => {
    const messy = file([
      "Messy",
      model(
        box("a", 40, 40) +
          box("b", 100, 70) + // half over a
          `<mxCell id="lane" value="Backend" style="swimlane;startSize=30;html=1;" vertex="1" parent="1"><mxGeometry x="400" y="20" width="200" height="150" as="geometry"/></mxCell>` +
          box("inside", 20, 50, "inside", "lane") +
          box("spills", 150, 50, "spills", "lane"),
      ),
    ]);
    const warnings = warningsOf(messy);
    assert.deepEqual(errorsOf(messy), []);
    assert.deepEqual(
      warnings.map((issue) => issue.cells),
      [
        ["a", "b"],
        ["spills", "lane"],
      ],
    );
    assert.match(warnings[0].message, /overlap/);
    assert.match(warnings[1].message, /outside its container "lane" \(Backend\)/);
  });

  test("deliberate stacking is not an overlap: a box wholly on another, unlabelled shapes, a sliver, a group", () => {
    const fine = file([
      "Fine",
      model(
        box("card", 40, 40, "card", "1", 'width="200" height="100"') +
          box("badge", 50, 50, "badge", "1", 'width="40" height="20"') + // wholly inside the card
          box("deco1", 400, 40, "") +
          box("deco2", 430, 60, "") + // unlabelled
          box("p", 40, 300) +
          box("q", 155, 300) + // 5 px of 120: a sliver
          `<mxCell id="g" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="600" y="40" width="50" height="50" as="geometry"/></mxCell>` +
          box("wide", 0, 0, "wide", "g", 'width="200" height="60"'), // overflows its invisible group
      ),
    ]);
    assert.deepEqual(checkDrawio(fine).issues, []);
  });

  // openlore: scenario=CompressedPagesAreRead spec=drawio-diagrams
  test("CompressedPagesAreRead: a page compressed as draw.io writes it is checked like a plain one", () => {
    const body = model(box("a", 40, 40) + link("e", "a", "ghost"));
    const plain = checkDrawio(file(["P", body]));
    const compressed = checkDrawio(file(["P", compress(body)]));
    assert.deepEqual(compressed, plain);
    assert.equal(compressed.issues.length, 1);
  });

  // openlore: scenario=CompressedPagesAreRead spec=drawio-diagrams
  test("CompressedPagesAreRead: files draw.io itself wrote, compressed pages and lanes, read clean", () => {
    assert.deepEqual(checkDrawio(readFileSync(path.join(FIXTURES, "jgraph-flowchart.drawio"), "utf8")), {
      pages: [{ name: "Page-1", shapes: 6, connectors: 5 }],
      issues: [],
    });
    assert.deepEqual(checkDrawio(readFileSync(path.join(FIXTURES, "jgraph-swimlanes.drawio"), "utf8")), {
      pages: [{ name: "Page-1", shapes: 12, connectors: 8 }],
      issues: [],
    });
  });

  test("every page is read, by name; a bare <mxGraphModel> is one page", () => {
    assert.deepEqual(
      readDrawio(file(["One", model(box("a", 0, 0))], ["Two", compress(model(box("b", 0, 0)))])).map((page) => [page.name, page.cells.length]),
      [
        ["One", 3],
        ["Two", 3],
      ],
    );
    assert.deepEqual(checkDrawio(model(box("a", 0, 0))).pages, [{ name: "Page-1", shapes: 1, connectors: 0 }]);
  });

  test("an HTML label is read as its text, and no tag can be rebuilt from nested brackets", () => {
    const cells = readDrawio(file(["P", model(box("a", 0, 0, "&lt;b&gt;Bold&lt;/b&gt;&lt;br&gt;line two") + box("b", 200, 0, "&lt;scr&lt;script&gt;ipt&gt;alert(1)"))]))[0].cells;
    assert.equal(cells[2].label, "Bold line two");
    assert.doesNotMatch(cells[3].label, /[<>]/);
  });

  test("a cell wrapped in <UserObject> takes the wrapper's id and label", () => {
    const wrapped = file(["P", model(`<UserObject id="u" label="Wrapped &amp; named" link="https://example.test"><mxCell vertex="1" parent="1"><mxGeometry width="80" height="40" as="geometry"/></mxCell></UserObject>` + link("e", "u", "u"))]);
    const cells = readDrawio(wrapped)[0].cells;
    assert.deepEqual(
      cells.map((cell) => [cell.id, cell.label]),
      [
        ["0", ""],
        ["1", ""],
        ["u", "Wrapped & named"],
        ["e", ""],
      ],
    );
    assert.deepEqual(checkDrawio(wrapped).issues, []);
  });

  test("what draw.io could not open is refused with the reason, never echoing bytes", () => {
    const reason = (xml: string) => {
      try {
        readDrawio(xml);
      } catch (error) {
        assert.ok(error instanceof DrawioReadError);
        return error.message;
      }
      assert.fail("expected a refusal");
    };
    assert.match(reason(""), /empty/);
    assert.match(reason("<html><body/></html>"), /root is <html>, not <mxfile> or <mxGraphModel>/);
    assert.match(reason("<mxfile></mxfile>"), /holds no <diagram> page/);
    assert.match(reason(file(["P", "!!not base64!!"])), /page "P" cannot be read/);
    assert.match(reason(file(["P", model("<mxCell id='a'>")])), /ends inside|closes/);
    assert.match(reason('<!DOCTYPE x [<!ENTITY a "b">]><mxfile/>'), /not well-formed XML/);
    const binary = reason(`<\u0089PNG\u0001\u0002${"ÿ".repeat(80)}>`);
    // Printable ASCII, and the ellipsis that marks a cut: none of the file's bytes
    assert.equal(
      [...binary].some((char) => char.charCodeAt(0) < 0x20 || (char.charCodeAt(0) >= 0x7f && char.charCodeAt(0) <= 0xff)),
      false,
    );
    assert.match(binary, /root is <\?PNG\?+…>/);
  });

  test("a compressed page cannot inflate past the cap", () => {
    const bomb = deflateRawSync(Buffer.alloc(MAX_INFLATED_PAGE_BYTES + 1024, "a")).toString("base64");
    assert.throws(() => inflatePage(bomb), /inflates past/);
  });

  test("the skill's own examples, assembled, pass the check", () => {
    // The skill teaches XML by example; a wrong example is taught to every diagram
    // CRLF on a Windows checkout
    const skill = readFileSync(path.join(import.meta.dirname, "..", "..", "skills", "drawio", "SKILL.md"), "utf8").replace(/\r\n/g, "\n");
    const blocks = [...skill.matchAll(/```xml\n([\s\S]*?)```/g)].map((match) => match[1]);
    assert.equal(blocks.length, 4, "skeleton, shape, connector, container");
    const [skeleton, shape, connector, container] = blocks;
    // The connector example goes to a database shape the skill leaves to the reader
    const database = box("db", 40, 200, "Orders");
    const diagram = skeleton.replace(/<!--[\s\S]*?-->/, shape + database + connector + container);
    const report = checkDrawio(diagram);
    assert.deepEqual(report.issues, []);
    assert.deepEqual(report.pages, [{ name: "Overview", shapes: 4, connectors: 1 }]);
  });
});

describe("drawio_check", () => {
  const root = mkdtempSync(path.join(tmpdir(), "pi-outpost-drawio-"));
  after(() => rmSync(root, { recursive: true, force: true }));
  const tool = createDrawioCheckToolDefinition({ cwd: root, allowedRoots: [root] });
  const run = (target: string) => (tool.execute as (id: string, params: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)("call", { path: target });

  test("reports on a file inside the workspace", async () => {
    writeFileSync(path.join(root, "clean.drawio"), CLEAN);
    const result = await run("clean.drawio");
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /valid draw\.io diagram with no defect/);
  });

  // openlore: scenario=TheCheckerStaysInTheSandbox spec=drawio-diagrams
  test("TheCheckerStaysInTheSandbox: outside the read zone is refused, unreadable files say why", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "pi-outpost-drawio-outside-"));
    try {
      writeFileSync(path.join(outside, "secret.drawio"), CLEAN);
      await assert.rejects(() => run(path.join(outside, "secret.drawio")), /Access denied/);
      await assert.rejects(() => run(path.join("..", path.basename(outside), "secret.drawio")), /Access denied/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    writeFileSync(path.join(root, "page.drawio"), "<html><body>not a diagram</body></html>");
    const unreadable = await run("page.drawio");
    assert.equal(unreadable.isError, true);
    assert.match(unreadable.content[0].text, /cannot be opened by draw\.io: its root is <html>/);
    const missing = await run("nope.drawio");
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /No such file/);
  });

  test("a file over the size limit is refused before it is read", async () => {
    const small = createDrawioCheckToolDefinition({ cwd: root, allowedRoots: [root], maxBytes: 100 });
    writeFileSync(path.join(root, "big.drawio"), CLEAN);
    const result = await (small.execute as (id: string, params: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }>)("call", { path: "big.drawio" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /larger than/);
  });
});
