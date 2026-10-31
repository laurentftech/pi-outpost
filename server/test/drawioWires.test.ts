/**
 * drawio_check on wires (drawio-diagrams: DrawioCheckSeesWires). The routes themselves are
 * compared with the vendored viewer's in e2e/drawio-routes.spec.ts; these hold the warnings to
 * routes whose shape is plain from the coordinates.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkDrawio, describeDrawioReport } from "../src/drawio.ts";
import { anchorWire, placeMovingEnds, wireAnchorIssues, type AnchorWire } from "../src/drawioAnchors.ts";
import { pageGeometry, routeWire } from "../src/drawioRoutes.ts";
import { readDrawio } from "../src/drawio.ts";

const model = (cells: string) => `<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const box = (id: string, x: number, y: number, style = "rounded=0;whiteSpace=wrap;html=1;", width = 120, height = 60) =>
  `<mxCell id="${id}" value="Box ${id}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/></mxCell>`;
const wire = (id: string, source: string, target: string, style: string, inner = "", value = "") =>
  `<mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${inner}</mxGeometry></mxCell>`;

const warnings = (xml: string) => checkDrawio(xml).issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message);
const ROW = box("a", 40, 40) + box("b", 240, 40) + box("c", 440, 40);

describe("drawio_check sees wires", () => {
  // openlore: scenario=AWireThroughAnotherBoxIsWarned spec=drawio-diagrams
  test("AWireThroughAnotherBoxIsWarned: straight and orthogonal, the middle box named with what to change", () => {
    for (const style of ["html=1;", "edgeStyle=orthogonalEdgeStyle;html=1;"]) {
      const found = warnings(model(ROW + wire("w", "a", "c", style)));
      assert.equal(found.length, 1, style);
      assert.match(found[0]!, /^connector "w" runs through shape "b" \(Box b\): move the shape off its path, give the connector a waypoint that goes around it/);
    }
    // Around the box with a waypoint row below it: no warning
    const around = wire("w", "a", "c", "edgeStyle=orthogonalEdgeStyle;html=1;", '<Array as="points"><mxPoint x="100" y="160"/><mxPoint x="500" y="160"/></Array>');
    assert.deepEqual(warnings(model(ROW + around)), []);
  });

  test("A wire grazing a box's edge, or crossing a container it lives in, is not warned", () => {
    // The wire runs at y=70; this box's bottom edge is at y=70
    assert.deepEqual(warnings(model(box("a", 40, 40) + box("b", 240, 10, undefined, 120, 60) + box("c", 440, 40) + wire("w", "a", "c", "html=1;"))), []);
    const lane = `<mxCell id="lane" value="Lane" style="swimlane;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="700" height="200" as="geometry"/></mxCell>`;
    const inside = (id: string, x: number) => `<mxCell id="${id}" value="Box ${id}" style="rounded=0;html=1;" vertex="1" parent="lane"><mxGeometry x="${x}" y="60" width="120" height="60" as="geometry"/></mxCell>`;
    assert.deepEqual(warnings(model(lane + inside("a", 40) + inside("c", 440) + wire("w", "a", "c", "html=1;"))), []);
  });

  // openlore: scenario=AWireThroughItsOwnEndIsWarned spec=drawio-diagrams
  test("AWireThroughItsOwnEndIsWarned: Codestral's top-to-bottom wire, both ends named, the facing sides given", () => {
    const xml = model(box("up", 300, 100, "ellipse;whiteSpace=wrap;html=1;", 120, 80) + box("down", 300, 250, "ellipse;whiteSpace=wrap;html=1;", 120, 80) +
      wire("w", "up", "down", "edgeStyle=none;curved=1;html=1;exitX=0.5;exitY=0;exitDx=0;exitDy=0;entryX=0.5;entryY=1;entryDx=0;entryDy=0;"));
    const found = warnings(xml);
    assert.equal(found.length, 1);
    assert.match(found[0]!, /^connector "w" runs through its source "up" \(Box up\) and its target "down" \(Box down\): its exit or entry is on a side facing away from the other end\. Put them on the sides facing each other \(exitX=0\.5;exitY=1;entryX=0\.5;entryY=0\)/);
    // Fixed on the facing sides: clean
    assert.deepEqual(warnings(xml.replace("exitY=0;", "exitY=1;").replace("entryY=1;", "entryY=0;")), []);
  });

  // openlore: scenario=ALabelOnABoxIsWarned spec=drawio-diagrams
  test("ALabelOnABoxIsWarned: a label moved onto a box beside the wire", () => {
    const shapes = box("a", 40, 200) + box("c", 440, 200) + box("b", 250, 190, undefined, 100, 30);
    // The wire runs at y=230, under b (190..220); its label 20 above the wire sits in b
    const found = warnings(model(shapes + wire("w", "a", "c", "html=1;", '<mxPoint as="offset" y="-20"/>', "Commande sécurité")));
    assert.equal(found.length, 1);
    assert.match(found[0]!, /^the label "Commande sécurité" of connector "w" \(Commande sécurité\) sits on shape "b" \(Box b\): move the label along the connector/);
    // Left on the wire, it is clear of b
    assert.deepEqual(warnings(model(shapes + wire("w", "a", "c", "html=1;", "", "Commande sécurité"))), []);
  });

  // openlore: scenario=AClearDiagramStaysClean spec=drawio-diagrams
  test("AClearDiagramStaysClean: wires between neighbours, labelled, ending on outlines", () => {
    const xml = model(box("a", 40, 40) + box("b", 240, 40, "ellipse;html=1;") + box("c", 240, 200, "rhombus;html=1;") +
      wire("ab", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;", "", "AC") + wire("bc", "b", "c", "html=1;", "", "DC") + wire("ac", "a", "c", "edgeStyle=elbowEdgeStyle;elbow=vertical;html=1;entryX=0;entryY=0.5;", "", "bus"));
    // "ac" enters the rhombus by its left point: left free, it took the top one "bc" ends on,
    // two different data on one point (DrawioCheckSeesSharedWirePoints)
    assert.deepEqual(checkDrawio(xml).issues, []);
  });

  test("drawio_check reports the anchor warnings with their wires, shapes and values", () => {
    const fan = box("a", 40, 100) + box("b", 300, 0) + box("c", 300, 200);
    const report = checkDrawio(model(fan + wire("w1", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;", "", "orders") + wire("w2", "a", "c", "edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;", "", "invoices")));
    assert.deepEqual(report.issues.map((issue) => [issue.severity, issue.cells]), [["warning", ["w1", "w2", "a"]]]);
    assert.match(report.issues[0]!.message, /^connectors "w1" \(orders\), "w2" \(invoices\) meet shape "a" \(Box a\) at the same point, and they carry different data: give each its own point on its right side: exitX=1;exitY=0\.25 for "w2" \(invoices\)/);
    const away = checkDrawio(model(box("a", 40, 40) + box("b", 300, 40) + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;exitX=0;exitY=0.5;")));
    assert.deepEqual(away.issues.map((issue) => issue.cells), [["w", "a"]]);
    assert.match(away.issues[0]!.message, /fix it on the side facing it \(exitX=1;exitY=0\.5\)/);
    const loop = '<Array as="points"><mxPoint x="100" y="300"/><mxPoint x="300" y="300"/></Array>';
    const detour = checkDrawio(model(box("a", 40, 40) + box("b", 240, 40) + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;", loop)));
    assert.deepEqual(detour.issues.map((issue) => issue.cells), [["w", "a", "b"]]);
  });

  test("Codestral's flows through their own ends: each is sent to its own facing point, and no advice contradicts another", () => {
    // Two flows from the sensor to the controller on its right, both leaving the sensor's top and
    // entering the controller's bottom: through both boxes, on one shared point at each end
    const style = "edgeStyle=none;html=1;exitX=0.5;exitY=0;entryX=0.5;entryY=1;";
    const xml = model(box("sensor", 40, 100) + box("controller", 300, 100) + wire("m", "sensor", "controller", style, "", "mesures") + wire("a", "sensor", "controller", style, "", "alarmes"));
    const found = warnings(xml);
    const own = found.filter((message) => /runs through its source/.test(message));
    assert.equal(own.length, 2);
    // The facing sides, each wire on its own point of them
    assert.match(own[0]!, /\(exitX=1;exitY=0\.25;entryX=0;entryY=0\.25\)/);
    assert.match(own[1]!, /\(exitX=1;exitY=0\.75;entryX=0;entryY=0\.75\)/);
    // No second opinion about the points they are leaving
    assert.deepEqual(found.filter((message) => /at the same point/.test(message)), []);
    // Following the advice leaves nothing to report
    const fixed = xml
      .replace(/(id="m"[^>]*style=")[^"]*/, "$1edgeStyle=none;html=1;exitX=1;exitY=0.25;entryX=0;entryY=0.25;")
      .replace(/(id="a"[^>]*style=")[^"]*/, "$1edgeStyle=none;html=1;exitX=1;exitY=0.75;entryX=0;entryY=0.75;");
    assert.deepEqual(warnings(fixed), []);
  });

  test("A report about connectors says how to edit one when several share a style", () => {
    const style = "edgeStyle=none;html=1;exitX=0.5;exitY=0;entryX=0.5;entryY=1;";
    const xml = model(box("sensor", 40, 100) + box("controller", 300, 100) + wire("m", "sensor", "controller", style, "", "mesures") + wire("a", "sensor", "controller", style, "", "alarmes"));
    assert.match(describeDrawioReport("d.drawio", checkDrawio(xml)), /\nTo change a connector with edit, include its id="…" in the text you replace/);
    // Only shapes at fault: no word about connectors
    const shapes = model(box("a", 40, 40) + box("b", 60, 60));
    const shapesReport = describeDrawioReport("d.drawio", checkDrawio(shapes));
    assert.match(shapesReport, /opens, but 1 warning/);
    assert.doesNotMatch(shapesReport, /To change a connector/);
  });

  // openlore: scenario=TheReportListsFixesInOrder spec=drawio-diagrams
  test("TheReportListsFixesInOrder: shapes, then where wires meet them, then routes, labels last", () => {
    // Emitted wire by wire, the crossing and the label would come before the shared point
    const xml = model(
      box("a", 40, 40) + box("b", 240, 40) + box("c", 440, 40) + box("d", 40, 200) + box("e", 60, 220) +
        wire("w", "a", "c", "html=1;", '<mxPoint as="offset" y="-20"/>', "through b") +
        wire("x", "a", "d", "edgeStyle=orthogonalEdgeStyle;html=1;exitX=0.5;exitY=1;", "", "orders") +
        wire("y", "a", "e", "edgeStyle=orthogonalEdgeStyle;html=1;exitX=0.5;exitY=1;", "", "invoices"),
    );
    const found = warnings(xml);
    const at = (pattern: RegExp) => found.findIndex((message) => pattern.test(message));
    const shapes = at(/^shapes "d" .* and "e" .* overlap/);
    const shared = at(/at the same point/);
    const crossing = at(/^connector "w" .* runs through shape "b"/);
    const label = at(/^the label "through b"/);
    assert.ok([shapes, shared, crossing, label].every((index) => index >= 0), JSON.stringify(found));
    assert.ok(shapes < shared && shared < crossing && crossing < label, JSON.stringify(found));
    assert.match(describeDrawioReport("d.drawio", checkDrawio(xml)), /Fix the warnings in the order listed, starting with the first: shapes, then where connectors meet them, then their routes, and labels last/);
  });

  // openlore: scenario=WaypointsThroughTheEndsAreNamed spec=drawio-diagrams
  test("WaypointsThroughTheEndsAreNamed: a wire its waypoints take back across its source is told to drop them, not given sides", () => {
    // No fixed exit or entry: the waypoints loop it back through its source
    const loop = '<Array as="points"><mxPoint x="100" y="20"/><mxPoint x="100" y="160"/><mxPoint x="400" y="160"/></Array>';
    const found = warnings(model(box("a", 40, 40) + box("b", 300, 40) + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;", loop)));
    const own = found.find((message) => /runs through its source/.test(message));
    assert.ok(own, JSON.stringify(found));
    assert.match(own, /its waypoints take it back across them\. Fix it: remove its waypoints \(the <Array as="points"> in its geometry\)/);
    assert.doesNotMatch(own, /exitX=|entryX=/);
  });

  describe("needless bends", () => {
    const points = (...xy: Array<[number, number]>) => `<Array as="points">${xy.map(([x, y]) => `<mxPoint x="${x}" y="${y}"/>`).join("")}</Array>`;
    const bends = (xml: string) => warnings(xml).filter((message) => /needless bend/.test(message));
    // A at y 40..100 (middle 70), B to its right, lower
    const pair = box("a", 40, 40) + box("b", 400, 200);

    // openlore: scenario=ANeedlessBendIsWarned spec=drawio-diagrams
    test("ANeedlessBendIsWarned: a waypoint a few units off its neighbour leaves a jog; the fix moves that waypoint", () => {
      // The exit is fixed at mid-height (y 70); the waypoint sits 6 below it
      const style = "edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;";
      const found = bends(model(pair + wire("w", "a", "b", style, points([300, 76], [300, 230]))));
      assert.equal(found.length, 1, JSON.stringify(found));
      assert.match(found[0]!, /^connector "w" has a needless bend near \(\d+, \d+\): a 6-unit segment\. Fix it: move its waypoint at \(300, 76\) to \(300, 70\)$/);
      // Following it leaves nothing to report
      assert.deepEqual(bends(model(pair + wire("w", "a", "b", style, points([300, 70], [300, 230])))), []);
    });

    test("a waypoint that sends a wire back over itself is named to be removed", () => {
      // Along y 150 the wire goes left to 250, then right again past where it was
      const found = bends(model(pair + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;", points([300, 70], [300, 150], [250, 150], [350, 150], [350, 230]))));
      assert.equal(found.length, 1, JSON.stringify(found));
      assert.match(found[0]!, /goes back over the one before it\. Fix it: remove its waypoint at \(250, 150\)/);
    });

    test("fixed ends at different heights make the jog: one is put level with the other", () => {
      const row = box("a", 40, 40) + box("b", 400, 40);
      const found = bends(model(row + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.4;", points([300, 70]))));
      assert.equal(found.length, 1, JSON.stringify(found));
      assert.match(found[0]!, /Fix it: put its entry level with its exit: entryY=0\.5$/);
    });

    // Luna's step: the same exitY and entryY on boxes of different heights, no waypoint at all
    // openlore: scenario=AStepBetweenFixedEndsIsWarned spec=drawio-diagrams
    test("AStepBetweenFixedEndsIsWarned: fixed ends at different heights make a step even without waypoints; the fix is tried on the route", () => {
      const steps = box("a", 40, 40, undefined, 120, 60) + box("b", 400, 40, undefined, 120, 80);
      const style = "edgeStyle=orthogonalEdgeStyle;html=1;exitX=1;exitY=0.3;entryX=0;entryY=0.3;";
      const found = bends(model(steps + wire("w", "a", "b", style)));
      assert.equal(found.length, 1, JSON.stringify(found));
      // a's 0.3 is y 58; b's 0.3 is y 64: b's entry at (58 - 40) / 80
      assert.match(found[0]!, /a 6-unit segment\. Fix it: put its entry level with its exit: entryY=0\.225$/);
      assert.deepEqual(bends(model(steps + wire("w", "a", "b", style.replace("entryY=0.3", "entryY=0.225")))), []);
    });

    test("a wire without waypoints is the router's own: no needless-bend warning", () => {
      assert.deepEqual(bends(model(pair + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;"))), []);
    });
  });

  // openlore: scenario=AnUnroutedWireIsLeftAlone spec=drawio-diagrams
  test("AnUnroutedWireIsLeftAlone: a style or an end the routing does not follow", () => {
    assert.deepEqual(warnings(model(ROW + wire("w", "a", "c", "edgeStyle=entityRelationEdgeStyle;html=1;"))), []);
    assert.deepEqual(warnings(model(box("a", 40, 40, "rounded=0;rotation=90;html=1;") + box("b", 240, 40) + box("c", 440, 40) + wire("w", "a", "c", "html=1;"))), []);
    assert.deepEqual(warnings(model(ROW + wire("w", "a", "c", "html=1;sourcePort=x;"))), []);
    // The routing says so: no route rather than a guess
    const page = readDrawio(model(ROW + wire("w", "a", "c", "edgeStyle=isometricEdgeStyle;html=1;")))[0]!;
    assert.equal(routeWire(page.cells.find((cell) => cell.id === "w")!, pageGeometry(page)), undefined);
  });

  test("A route is draw.io's: an orthogonal wire around the corner, ends on the outlines", () => {
    const page = readDrawio(model(box("a", 40, 40) + box("b", 240, 200) + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;")))[0]!;
    const route = routeWire(page.cells.find((cell) => cell.id === "w")!, pageGeometry(page))!;
    // Out of a's right side at its middle, down to b's top at its middle: the viewer's route
    assert.deepEqual(route.points, [{ x: 160, y: 70 }, { x: 300, y: 70 }, { x: 300, y: 200 }]);
  });
});

describe("where wires meet their shapes (drawio-wire-anchors)", () => {
  /** The anchor rules on the check's own routes, as drawio_check runs them. */
  const anchors = (xml: string) => {
    const page = readDrawio(xml)[0]!;
    const geometry = pageGeometry(page);
    const wires = page.cells.flatMap((cell) => {
      if (!cell.edge || cell.id === undefined) return [];
      const route = routeWire(cell, geometry);
      return route === undefined ? [] : [anchorWire({ ...cell, id: cell.id }, page.cells, route.points, geometry.origins.get(cell.id) ?? undefined)];
    });
    return wireAnchorIssues(wires, new Map([...geometry.terminals].map(([id, terminal]) => [id, terminal.box])));
  };
  const ORTHO = "edgeStyle=orthogonalEdgeStyle;html=1;";
  const FAN = box("a", 40, 100) + box("b", 300, 0) + box("c", 300, 200);

  // openlore: scenario=SharedPointWithDifferentLabelsIsWarned spec=drawio-diagrams
  test("SharedPointWithDifferentLabelsIsWarned: both wires and the box named, another point on the side offered", () => {
    const issues = anchors(model(FAN + wire("w1", "a", "b", `${ORTHO}exitX=1;exitY=0.5;`, "", "orders") + wire("w2", "a", "c", `${ORTHO}exitX=1;exitY=0.5;`, "", "invoices")));
    assert.deepEqual(issues.map((issue) => [issue.rule, issue.wires, issue.shapes]), [["shared-point", ["w1", "w2"], ["a"]]]);
    assert.match(issues[0]!.message, /carry different data/);
    assert.match(issues[0]!.message, /exitX=1;exitY=0\.25 for "w2"/);
  });

  // openlore: scenario=SharedPointWithTheSameLabelIsAllowed spec=drawio-diagrams
  test("SharedPointWithTheSameLabelIsAllowed: the same data may share its point, whatever the case or spacing", () => {
    const issues = anchors(model(FAN + wire("w1", "a", "b", `${ORTHO}exitX=1;exitY=0.5;`, "", "orders") + wire("w2", "a", "c", `${ORTHO}exitX=1;exitY=0.5;`, "", " Orders ")));
    assert.deepEqual(issues.filter((issue) => issue.rule === "shared-point"), []);
  });

  // openlore: scenario=UnlabelledWiresOnOnePointAreWarned spec=drawio-diagrams
  test("UnlabelledWiresOnOnePointAreWarned: two unlabelled wires entering one point", () => {
    const issues = anchors(model(box("a", 300, 100) + box("b", 40, 0) + box("c", 40, 200) + wire("w1", "b", "a", `${ORTHO}entryX=0;entryY=0.5;`) + wire("w2", "c", "a", `${ORTHO}entryX=0;entryY=0.5;`)));
    assert.deepEqual(issues.map((issue) => [issue.rule, issue.wires, issue.shapes]), [["shared-point", ["w1", "w2"], ["a"]]]);
    assert.match(issues[0]!.message, /not labelled as the same data/);
    assert.match(issues[0]!.message, /entryX=0;entryY=0\.25 for "w2"/);
  });

  // openlore: scenario=WiresDrawnToTheSamePointWithoutFixedPointsAreWarned spec=drawio-diagrams
  test("WiresDrawnToTheSamePointWithoutFixedPointsAreWarned: draw.io lands two wires on one point by itself", () => {
    const issues = anchors(model(box("a", 40, 40) + box("b", 300, 40) + wire("w1", "a", "b", "html=1;", "", "orders") + wire("w2", "a", "b", "html=1;", "", "invoices")));
    assert.deepEqual(issues.map((issue) => [issue.rule, issue.wires, issue.shapes]), [
      ["shared-point", ["w1", "w2"], ["a"]],
      ["shared-point", ["w1", "w2"], ["b"]],
    ]);
  });

  test("A wire's label cell counts as its label however it is placed", () => {
    // Codestral's labels: child cells of the wire with an absolute geometry, the wire's own value empty
    const label = (id: string, wireId: string, text: string) =>
      `<mxCell id="${id}" value="${text}" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="${wireId}"><mxGeometry x="10" y="0" as="geometry"/></mxCell>`;
    const same = anchors(model(FAN + wire("w1", "a", "b", `${ORTHO}exitX=1;exitY=0.5;`) + wire("w2", "a", "c", `${ORTHO}exitX=1;exitY=0.5;`) + label("l1", "w1", "orders") + label("l2", "w2", "orders")));
    assert.deepEqual(same.filter((issue) => issue.rule === "shared-point"), []);
    const different = anchors(model(FAN + wire("w1", "a", "b", `${ORTHO}exitX=1;exitY=0.5;`) + wire("w2", "a", "c", `${ORTHO}exitX=1;exitY=0.5;`) + label("l1", "w1", "orders") + label("l2", "w2", "invoices")));
    assert.match(different.find((issue) => issue.rule === "shared-point")!.message, /carry different data/);
  });

  test("A side with no free point left sends the rest to another side, with values", () => {
    // Seven flows hold the seven positions of a's right side; three more share its middle
    const positions = [0.125, 0.25, 0.375, 0.625, 0.75, 0.875];
    const targets = Array.from({ length: 9 }, (_, i) => box(`t${i}`, 400, i * 80));
    const held = positions.map((y, i) => wire(`h${i}`, "a", `t${i}`, `${ORTHO}exitX=1;exitY=${y};`, "", `held ${i}`));
    const crowd = ["one", "two", "three"].map((label, i) => wire(`c${i}`, "a", `t${6 + i}`, `${ORTHO}exitX=1;exitY=0.5;`, "", label));
    const issues = anchors(model(box("a", 40, 200, undefined, 120, 240) + targets.join("") + held.join("") + crowd.join("")));
    const shared = issues.filter((issue) => issue.rule === "shared-point" && issue.shapes[0] === "a");
    assert.equal(shared.length, 1);
    // Values on another side, not just "another side": a model given no value has nothing to apply
    assert.match(shared[0]!.message, /that right side has no free point left, so move them to other sides: exitX=0\.\d+;exitY=1 for "c1", on its bottom, exitX=0\.\d+;exitY=1 for "c2", on its bottom/);
  });

  test("Codestral's four flows on one point: each gets a free point on the same side", () => {
    const at = (label: string, id: string, to: string) => wire(id, "a", to, `${ORTHO}exitX=1;exitY=0.5;`, "", label);
    const issues = anchors(model(box("a", 40, 100, undefined, 120, 120) + box("b", 300, 0) + box("c", 300, 200) + box("d", 300, 400) + box("e", 300, 600) + at("one", "w1", "b") + at("two", "w2", "c") + at("three", "w3", "d") + at("four", "w4", "e")));
    const shared = issues.filter((issue) => issue.rule === "shared-point" && issue.shapes[0] === "a");
    assert.equal(shared.length, 1);
    // A side holds seven points before any wire is sent to another one
    assert.match(shared[0]!.message, /give each its own point on its right side: exitX=1;exitY=0\.25 for "w2", exitX=1;exitY=0\.75 for "w3", exitX=1;exitY=0\.125 for "w4"\./);
    assert.doesNotMatch(shared[0]!.message, /has no free point left, so/);
  });

  // openlore: scenario=AnEndFacingAwayIsWarned spec=drawio-diagrams
  test("AnEndFacingAwayIsWarned: leaving by the side away from the target, the facing side given", () => {
    const issues = anchors(model(box("a", 40, 40) + box("b", 300, 40) + wire("w", "a", "b", `${ORTHO}exitX=0;exitY=0.5;`)));
    const away = issues.filter((issue) => issue.rule === "facing-away");
    assert.deepEqual(away.map((issue) => [issue.wires, issue.shapes]), [[["w"], ["a"]]]);
    assert.match(away[0]!.message, /leaves shape "a" on its left side, facing away from "b"/);
    assert.match(away[0]!.message, /exitX=1;exitY=0\.5/);
    // One message about its ends: no detour on top
    assert.deepEqual(issues.filter((issue) => issue.rule === "detour"), []);
  });

  test("A corner, or a side that is only perpendicular, is not facing away", () => {
    const corner = anchors(model(box("a", 40, 40) + box("b", 300, 40) + wire("w", "a", "b", `${ORTHO}exitX=0;exitY=0;`)));
    assert.deepEqual(corner.filter((issue) => issue.rule === "facing-away"), []);
    const top = anchors(model(box("a", 40, 40) + box("b", 300, 40) + wire("w", "a", "b", `${ORTHO}exitX=0.5;exitY=0;`)));
    assert.deepEqual(top.filter((issue) => issue.rule === "facing-away"), []);
  });

  // openlore: scenario=ADetourIsWarned spec=drawio-diagrams
  test("ADetourIsWarned: a loop through waypoints between neighbours 80 apart", () => {
    const loop = '<Array as="points"><mxPoint x="100" y="300"/><mxPoint x="300" y="300"/></Array>';
    const issues = anchors(model(box("a", 40, 40) + box("b", 240, 40) + wire("w", "a", "b", ORTHO, loop)));
    assert.deepEqual(issues.map((issue) => [issue.rule, issue.wires, issue.shapes]), [["detour", ["w"], ["a", "b"]]]);
    assert.match(issues[0]!.message, /facing sides are 80 apart: fix its exit and entry on those sides \(exitX=1;exitY=0\.5;entryX=0;entryY=0\.5\), or give it a waypoint/);
  });

  test("Overlapping ends have no facing sides: no detour", () => {
    const loop = '<Array as="points"><mxPoint x="100" y="400"/><mxPoint x="300" y="400"/></Array>';
    const issues = anchors(model(box("a", 40, 40) + box("b", 100, 60) + wire("w", "a", "b", ORTHO, loop)));
    assert.deepEqual(issues.filter((issue) => issue.rule === "detour"), []);
  });

  // openlore: scenario=DirectWiresOnDistinctPointsStayClean spec=drawio-diagrams
  test("DirectWiresOnDistinctPointsStayClean: own points, facing sides, short routes", () => {
    const issues = anchors(model(
      box("a", 40, 40) + box("b", 240, 40) + box("c", 40, 200) +
        wire("w1", "a", "b", `${ORTHO}exitX=1;exitY=0.5;entryX=0;entryY=0.5;`, "", "orders") +
        wire("w2", "a", "c", `${ORTHO}exitX=0.5;exitY=1;entryX=0.5;entryY=0;`, "", "invoices") +
        wire("w3", "b", "c", "html=1;", "", "stock"),
    ));
    assert.deepEqual(issues, []);
  });
});

describe("points handed out on a crowded shape", () => {
  const at = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const line = (id: string, source: string, target: string, from: { x: number; y: number }, to: { x: number; y: number }, label = id, exit?: { x: number; y: number }): AnchorWire => ({
    id,
    label,
    source,
    target,
    exit,
    entry: undefined,
    points: [from, to],
    waypoints: [],
  });

  test("more ends than a side has points: the rest go to another side, never back onto a point in use", () => {
    // Nine wires leave a on its left, facing away from t on the right: all nine move to the right side
    const boxes = new Map([["a", at(0, 0, 100, 100)], ["t", at(400, 0, 100, 900)]]);
    const wires = Array.from({ length: 9 }, (_, index) => line(`w${index}`, "a", "t", { x: 0, y: 50 }, { x: 400, y: 50 + index * 100 }, `w${index}`, { x: 0, y: 0.5 }));
    const placements = placeMovingEnds(wires, boxes, new Set(wires.map((wire) => `${wire.id}:exit`)));
    const values = wires.map((wire) => placements.get(`${wire.id}:exit`));
    assert.equal(new Set(values).size, 9, values.join(" | "));
    assert.equal(values.filter((value) => value?.startsWith("X=1;")).length, 7, values.join(" | "));
  });

  test("a point handed to another shape's end does not count as taken on this one", () => {
    // a's right side holds a wire at each of the seven positions, and an eighth shares the middle:
    // it goes to a's bottom, where nothing is. b's two ends move to b's bottom, 0.25 and 0.75 —
    // fractions of b, which say nothing about a's bottom
    const boxes = new Map([["a", at(0, 0, 100, 100)], ["t", at(400, 0, 100, 900)], ["b", at(0, 300, 100, 100)], ["c", at(0, 600, 100, 100)]]);
    const along = [12.5, 25, 37.5, 50, 62.5, 75, 87.5];
    const wires = [
      ...along.map((y, index) => line(`r${index}`, "a", "t", { x: 100, y }, { x: 400, y: 50 + index * 100 })),
      line("r7", "a", "t", { x: 100, y: 50 }, { x: 400, y: 800 }),
      line("b1", "b", "c", { x: 50, y: 300 }, { x: 25, y: 600 }, "b1", { x: 0.5, y: 0 }),
      line("b2", "b", "c", { x: 50, y: 300 }, { x: 75, y: 600 }, "b2", { x: 0.5, y: 0 }),
    ];
    const shared = wireAnchorIssues(wires, boxes).find((issue) => issue.rule === "shared-point" && issue.shapes[0] === "a");
    assert.ok(shared, "the shared middle of a's right side is warned");
    assert.match(shared.message, /exitX=0\.25;exitY=1 for "r7", on its bottom/);
  });
});
