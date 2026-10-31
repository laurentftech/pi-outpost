/**
 * drawio_check's anchor advice, followed to the letter, converges (drawio-diagrams:
 * FollowingTheAdviceConverges). The diagrams are what Codestral left in live runs, and the ones
 * the viewer corpus holds from other models: whatever a model does with the advice, the advice
 * itself must not send a wire to a point that brings another warning back.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { checkDrawio } from "../src/drawio.ts";
import { applyLabelMoves, applyWaypointFixes, applyWaypointSets, followAdvice, labelMoves, stripWaypoints } from "@pi-outpost/shared/drawio/follow-advice";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const files = [
  ...readdirSync(path.join(FIXTURES, "drawio-advice")).filter((name) => name.endsWith(".drawio")).map((name) => path.join("drawio-advice", name)),
  ...readdirSync(path.join(FIXTURES, "drawio")).filter((name) => name.startsWith("live-") && name.endsWith(".drawio")).map((name) => path.join("drawio", name)),
];

describe("following drawio_check's anchor advice", () => {
  // openlore: scenario=FollowingTheAdviceConverges spec=drawio-diagrams
  for (const file of files) {
    test(`FollowingTheAdviceConverges: ${file}`, () => {
      const result = followAdvice(readFileSync(path.join(FIXTURES, file), "utf8"));
      assert.equal(result.looped, false, `the advice went round: ${result.left.join(" | ")}`);
      if (path.basename(file).startsWith("luna")) {
        // The diagrams the user judged by eye: every warning had a fix, and the fixes cleared them all
        assert.deepEqual(result.left, [], "every warning gave something to apply, and applying it cleared it");
      } else {
        // Crowded diagrams can leave a warning no single value fixes: then it must say so, not
        // give a value that would only move the problem
        for (const message of result.left) assert.doesNotMatch(message, /(?:exit|entry)[XY]=|set x="|add a waypoint|move its waypoint/, message);
      }
    });
  }
  test("there are diagrams to follow the advice on", () => assert.ok(files.length >= 7, files.join(", ")));
});

describe("between wires, on Luna's diagrams", () => {
  const read = (name: string) => readFileSync(path.join(FIXTURES, "drawio-advice", name), "utf8");
  const messages = (xml: string) => checkDrawio(xml).issues.map((issue) => issue.message);

  // openlore: scenario=LabelsOnLabelsAreWarned spec=drawio-diagrams
  test("LabelsOnLabelsAreWarned: two labels drawn on each other, the second given a clear place along its wire", () => {
    const xml = read("luna2-services.drawio");
    const found = messages(xml).find((message) => /lies on the label/.test(message));
    assert.ok(found, JSON.stringify(messages(xml)));
    assert.match(found, /^the label "écriture" of connector "orders-db-write" \(écriture\) lies on the label "paiement reçu" of connector "payments-queue" \(paiement reçu\): move it (?:along|beside) its connector: set x="-?[\d.]+"(?: y="-?\d+")? in the mxGeometry of "orders-db-write"/);
    const after = applyLabelMoves(xml, labelMoves([found]));
    assert.equal(messages(after).some((message) => /the label "écriture" of connector "orders-db-write".*lies on the label/.test(message)), false, JSON.stringify(messages(after)));
  });

  // openlore: scenario=AWireAlongAnotherIsWarned spec=drawio-diagrams
  test("AWireAlongAnotherIsWarned: two VLANs drawn down the same line, one moved off it by a waypoint tried first", () => {
    const xml = read("luna2-reseau.drawio");
    const found = messages(xml).find((message) => /"switch-mail" and "switch-workstations".*run along the same line/.test(message));
    assert.ok(found, JSON.stringify(messages(xml)));
    assert.match(found, /for 71 units .* not labelled as the same data: a reader cannot tell them apart\. Fix "switch-workstations" \(VLAN postes\): (?:add waypoints? at \(-?\d+, -?\d+\)|move its waypoints? |move its (?:exit|entry) to )/);
    const result = followAdvice(xml);
    assert.equal(result.left.some((message) => /run along the same line/.test(message)), false, result.left.join(" | "));
  });

  // openlore: scenario=ALabelAcrossAWireIsWarned spec=drawio-diagrams
  test("ALabelAcrossAWireIsWarned: a label drawn over another wire, moved along its own", () => {
    const xml = read("luna2-services.drawio");
    const found = messages(xml).find((message) => /"paiement reçu".*lies across connector "orders-db-read"/.test(message));
    assert.ok(found, JSON.stringify(messages(xml)));
    assert.match(found, /move it (?:along|beside) its connector: set x="-?[\d.]+"(?: y="-?[\d.]+")? in the mxGeometry of "payments-queue"/);
    const after = applyLabelMoves(xml, labelMoves([found]));
    assert.equal(messages(after).some((message) => /"paiement reçu".*lies across connector/.test(message)), false, JSON.stringify(messages(after)));
  });

  // openlore: scenario=TheSameDataMayShareALine spec=drawio-diagrams
  test("TheSameDataMayShareALine: a label already clear, and wires of the same data along one line, are not warned", () => {
    // services' two "lecture" wires share a few units: the same data may share a line
    assert.equal(messages(read("luna2-services.drawio")).some((message) => /"lecture".*run along the same line/.test(message)), false);
  });
});

describe("applying advice to one wire leaves the next one alone", () => {
  test("waypoints set on a wire with none, and a waypoint moved on the next, both land where they were meant", () => {
    const xml = [
      '<mxCell id="a" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="x" target="y"><mxGeometry x="0.3" y="-14" relative="1" as="geometry"/></mxCell>',
      '<mxCell id="b" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="x" target="y"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="230" y="147"/></Array></mxGeometry></mxCell>',
    ].join("\n");
    const moved = applyWaypointFixes(xml, [{ wire: "b", from: { x: 230, y: 147 }, to: { x: 230, y: 135 } }]);
    const set = applyWaypointSets(moved, [{ wire: "a", points: [{ x: 100, y: 50 }] }]);
    const [first, second] = set.split("\n");
    assert.match(first!, /<Array as="points"><mxPoint x="100" y="50"\/><\/Array>/);
    assert.match(second!, /<mxPoint x="230" y="135"\/>/);
    // A wire with no waypoints has none to move or strip: the next wire's are not taken for its own
    assert.equal(applyWaypointFixes(xml, [{ wire: "a", from: { x: 230, y: 147 }, to: null }]), xml);
    assert.equal(stripWaypoints(xml, new Set(["a"])), xml);
  });
});
