/**
 * drawio_check on wires (drawio-diagrams: DrawioCheckSeesWires). The routes themselves are
 * compared with the vendored viewer's in e2e/drawio-routes.spec.ts; these hold the warnings to
 * routes whose shape is plain from the coordinates.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkDrawio } from "../src/drawio.ts";
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
      wire("ab", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;", "", "AC") + wire("bc", "b", "c", "html=1;", "", "DC") + wire("ac", "a", "c", "edgeStyle=elbowEdgeStyle;elbow=vertical;html=1;", "", "bus"));
    assert.deepEqual(checkDrawio(xml).issues, []);
  });

  // openlore: scenario=AnUnroutedWireIsLeftAlone spec=drawio-diagrams
  test("AnUnroutedWireIsLeftAlone: a style or an end the routing does not follow", () => {
    assert.deepEqual(warnings(model(ROW + wire("w", "a", "c", "edgeStyle=entityRelationEdgeStyle;html=1;"))), []);
    assert.deepEqual(warnings(model(box("a", 40, 40, "rounded=0;rotation=90;html=1;") + box("b", 240, 40) + box("c", 440, 40) + wire("w", "a", "c", "html=1;"))), []);
    assert.deepEqual(warnings(model(ROW + wire("w", "a", "c", "html=1;sourcePort=x;"))), []);
    // The routing says so: no route rather than a guess
    const page = readDrawio(model(ROW + wire("w", "a", "c", "edgeStyle=isometricEdgeStyle;html=1;")))[0]!;
    assert.equal(routeWire(page.cells.find((cell) => cell.id === "w")!, pageGeometry(page)), undefined);
    // draw.io 32.6 ends a wire on the label of a shape with labelPerimeter=1, not on its outline
    const labelled = readDrawio(model(box("a", 40, 40, "shape=image;labelPerimeter=1;verticalLabelPosition=bottom;html=1;") + box("b", 240, 40) + box("c", 440, 40) + wire("w", "a", "c", "html=1;")))[0]!;
    assert.equal(routeWire(labelled.cells.find((cell) => cell.id === "w")!, pageGeometry(labelled)), undefined);
  });

  test("A route is draw.io's: an orthogonal wire around the corner, ends on the outlines", () => {
    const page = readDrawio(model(box("a", 40, 40) + box("b", 240, 200) + wire("w", "a", "b", "edgeStyle=orthogonalEdgeStyle;html=1;")))[0]!;
    const route = routeWire(page.cells.find((cell) => cell.id === "w")!, pageGeometry(page))!;
    // Out of a's right side at its middle, down to b's top at its middle: the viewer's route
    assert.deepEqual(route.points, [{ x: 160, y: 70 }, { x: 300, y: 70 }, { x: 300, y: 200 }]);
  });
});
