/**
 * A graph arranged in draw.io's touch-up and read back (structured-exchange-arrangement,
 * AFigureCanBeArrangedInDrawioTouchUp): what is arrangement is kept by identity, and anything
 * else is named as not kept.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readDrawio, type DrawioPage } from "@pi-outpost/shared/drawio/read";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { readTouchUp } from "@pi-outpost/shared/structured-exchange/touch-up";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

const data: StructuredGraphData = {
  nodes: [
    { id: "battery", label: "Battery", ref: "EL-BAT" },
    { id: "inverter", label: "Inverter" },
    { id: "motor", label: "Motor" },
  ],
  edges: [
    { from: "battery", to: "inverter", kind: "power", label: "400 V" },
    { from: "inverter", to: "motor", kind: "power", label: "three-phase" },
  ],
};

/** The figure's page as touch-up opens it, edited as text the way draw.io writes its model, and read back. */
function edited(change: (xml: string) => string): { drawn: DrawioPage; saved: DrawioPage } {
  const drawn = graphFigurePage(data);
  const xml = writeDrawio(drawn);
  const model = /<mxGraphModel>[\s\S]*<\/mxGraphModel>/.exec(change(xml))![0];
  return { drawn, saved: readDrawio(model)[0]! };
}

/** Sets an attribute of one cell's geometry. */
const geometry = (xml: string, id: string, attribute: string, value: number) =>
  xml.replace(new RegExp(`(<mxCell id="${id}"[^>]*>\\s*<mxGeometry\\b[^>]*?\\b${attribute}=")[^"]*(")`), `$1${value}$2`);

describe("a touch-up read back", () => {
  // openlore: scenario=ATouchUpIsReadBackByIdentity spec=structured-exchange-arrangement
  test("ATouchUpIsReadBackByIdentity: a moved box, a wire's end moved to another side, a bend removed, kept by identity", () => {
    const { drawn, saved } = edited((xml) => {
      let out = geometry(xml, "n:motor", "y", 400);
      // The wire into the motor now enters on its left side; its bends removed
      out = out.replace(/(<mxCell id="r:1"[^>]*style=")([^"]*)(")/, (_all, head: string, style: string, tail: string) => `${head}${style.replace(/entryX=[^;]*;entryY=[^;]*;/, "")}entryX=0;entryY=0.5;${tail}`);
      return out.replace(/(<mxCell id="r:0"[^>]*>[\s\S]*?)<Array as="points">[\s\S]*?<\/Array>/, "$1");
    });
    const { view, notKept } = readTouchUp(data, drawn, saved, undefined, "landscape");
    assert.deepEqual(notKept, []);
    assert.equal(view.elements["id:motor"]!.y, 400);
    // The battery is named by its reference, as the arrangement names it
    assert.ok(view.elements["ref:EL-BAT"]);
    assert.deepEqual(view.relationships["id:inverter>id:motor[power]#0"]!.entry, { x: 0, y: 0.5 });
    assert.equal(view.relationships["ref:EL-BAT>id:inverter[power]#0"]!.waypoints, undefined);
    // Drawn again with what was read, the motor is where it was put
    const again = graphFigurePage(data, { arrangement: view });
    assert.equal(again.cells.find((cell) => cell.id === "n:motor")!.geometry!.y, 400);
  });

  // openlore: scenario=AContentEditInDrawioIsNotAModelChange spec=structured-exchange-arrangement
  test("AContentEditInDrawioIsNotAModelChange: a box's text edited and a wire deleted are named as not kept, and the places are", () => {
    const { drawn, saved } = edited((xml) =>
      geometry(xml, "n:battery", "x", 300)
        .replace(/(<mxCell id="n:inverter" value=")Inverter(")/, "$1Onduleur$2")
        .replace(/<mxCell id="r:1"[\s\S]*?<\/mxCell>/, ""),
    );
    const { view, notKept } = readTouchUp(data, drawn, saved, undefined, "landscape");
    assert.deepEqual(notKept, [
      'the text of "Inverter" was changed to "Onduleur": the document\'s text is not changed from here',
      '"Inverter → Motor" was deleted: the document still holds it, so it is drawn again',
    ]);
    assert.equal(view.elements["ref:EL-BAT"]!.x, 300);
  });

  test("a box added, a wire re-attached and a colour changed are named as not kept, and none of them enters the arrangement", () => {
    const { drawn, saved } = edited((xml) =>
      xml
        .replace("</root>", '<mxCell id="extra" value="Note" style="rounded=0;" vertex="1" parent="1"><mxGeometry x="600" y="40" width="80" height="30" as="geometry"/></mxCell></root>')
        .replace(/(<mxCell id="r:0"[^>]*target=")n:inverter(")/, "$1n:motor$2")
        .replace(/(<mxCell id="n:motor"[^>]*style=")([^"]*)(")/, "$1$2fillColor=#ff0000;$3"),
    );
    const { view, notKept } = readTouchUp(data, drawn, saved, undefined, "landscape");
    assert.deepEqual(notKept, [
      // In the page's order: boxes, then connectors, then what was added
      'the look of "Motor" was changed: colours and styles come from the document\'s kinds and the project',
      '"Battery → Inverter" was attached to other boxes: a relationship\'s ends are the document\'s, so it keeps them',
      'a box "Note" was added: the document is not changed from here',
    ]);
    assert.equal(view.elements.extra, undefined);
    // The re-attached wire's touch-up is not taken: it keeps whatever it had
    assert.equal(view.relationships["ref:EL-BAT>id:inverter[power]#0"], undefined);
  });
});
