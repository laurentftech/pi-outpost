/**
 * A graph opened as a file keeps its arrangement beside it (structured-exchange-arrangement):
 * read when the document opens, written when the reader keeps a move, never the document itself,
 * and said not to be kept where the document cannot be written.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { readArrangement, writeArrangement, type Arrangement } from "@pi-outpost/shared/structured-exchange/arrangement";
import { parseStructuredExchange } from "@pi-outpost/shared/structured-exchange/parse";
import type { ValidatedStructuredExchange } from "@pi-outpost/shared/structured-exchange";
import { checkStructuredExchangeSchemaInBrowser } from "@pi-outpost/shared/structured-exchange/schema-browser";
import { DrawioFilesContext } from "../components/drawioFiles";
import { FileIoError, type FileIo } from "../fileIo";
import { StructuredExchangeDocument } from "./StructuredExchangeView";

const DOCUMENT = {
  schema: "urn:structured-exchange:1",
  kind: "graph",
  data: {
    nodes: [
      { id: "battery", label: "Battery" },
      { id: "inverter", label: "Inverter" },
      { id: "motor", label: "Motor" },
    ],
    edges: [
      { from: "battery", to: "inverter", kind: "power" },
      { from: "inverter", to: "motor", kind: "power" },
    ],
  },
};
const SOURCE = JSON.stringify(DOCUMENT);
const envelope = (() => {
  const outcome = parseStructuredExchange(DOCUMENT, checkStructuredExchangeSchemaInBrowser);
  if (!outcome.valid) throw new Error("the fixture does not validate");
  return outcome.envelope as ValidatedStructuredExchange;
})();

/** A fileIo holding at most an arrangement file, recording what it was asked to keep. */
function fakeFileIo(stored?: string) {
  const kept: Array<{ documentPath: string; content: string }> = [];
  const io: FileIo = {
    read: (path) => (stored !== undefined && path === "models/car.arrangement.json" ? Promise.resolve({ content: stored, mtimeMs: 1 }) : Promise.reject(new FileIoError("not found", "not-found"))),
    write: () => Promise.reject(new Error("unused")),
    onChanged: () => () => {},
    keepArrangement: (documentPath, content) => {
      kept.push({ documentPath, content });
      return Promise.resolve(documentPath.replace(/\.json$/, ".arrangement.json"));
    },
  };
  return { io, kept };
}

const mount = (io: FileIo, writable = true) =>
  render(
    <DrawioFilesContext.Provider value={{ serverUrl: "", fileIo: io }}>
      <StructuredExchangeDocument envelope={envelope} source={SOURCE} file={{ path: "models/car.json", writable }} />
    </DrawioFilesContext.Provider>,
  );

/** The first box's top-left corner as drawn. */
const firstBox = () => {
  const rect = document.querySelector('[data-draggable="node"] rect')!;
  return { x: Number(rect.getAttribute("x")), y: Number(rect.getAttribute("y")) };
};

const drag = (by: { x: number; y: number }) => {
  const node = document.querySelector('[data-draggable="node"]') as SVGGElement;
  (node as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  (node as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};
  fireEvent.pointerDown(node, { clientX: 100, clientY: 200, button: 0, pointerId: 1 });
  fireEvent.pointerMove(node, { clientX: 100 + by.x, clientY: 200 + by.y, button: 0, pointerId: 1 });
  fireEvent.pointerUp(node, { clientX: 100 + by.x, clientY: 200 + by.y, button: 0, pointerId: 1 });
};

describe("a graph's arrangement beside its file", () => {
  // openlore: scenario=AMovedBoxIsKeptInTheArrangement spec=structured-exchange-arrangement
  it("AMovedBoxIsKeptInTheArrangement: a box moved is kept beside the document, for the view shown, and drawn there", async () => {
    const { io, kept } = fakeFileIo();
    mount(io);
    const before = firstBox();
    await act(async () => drag({ x: 0, y: 120 }));
    await waitFor(() => expect(kept).toHaveLength(1));
    expect(kept[0]!.documentPath).toBe("models/car.json");
    const reading = readArrangement(kept[0]!.content);
    expect(reading.ok).toBe(true);
    const view = (reading as { arrangement: Arrangement }).arrangement.views[""]!;
    // Every element recorded, the moved one where it was dropped, on the grid
    expect(Object.keys(view.elements).sort()).toEqual(["id:battery", "id:inverter", "id:motor"]);
    expect(view.elements["id:battery"]!.y).toBe(Math.round((before.y + 120) / 10) * 10);
    expect(firstBox().y).toBe(view.elements["id:battery"]!.y);
    // Its relationship was released to be routed again from the new place; the other was kept
    expect(view.relationships["id:battery>id:inverter[power]#0"]).toBeUndefined();
    expect(view.relationships["id:inverter>id:motor[power]#0"]).toBeDefined();
  });

  // openlore: scenario=AKeptRepositioningIsNotADocumentChange spec=structured-exchange
  it("AKeptRepositioningIsNotADocumentChange: what is kept is an arrangement, and reopening draws the box where it was left", async () => {
    const { io, kept } = fakeFileIo();
    const first = mount(io);
    await act(async () => drag({ x: 40, y: 0 }));
    await waitFor(() => expect(kept).toHaveLength(1));
    // Only the arrangement was written: no write to the document, whose source is untouched
    expect(kept[0]!.content).not.toContain("urn:structured-exchange");
    const where = firstBox();
    first.unmount();

    // Reopened with the arrangement on disk: the box is where the reader left it
    const { io: reopened } = fakeFileIo(kept[0]!.content);
    mount(reopened);
    await waitFor(() => expect(firstBox()).toEqual(where));
  });

  it("a document outside the writable zone says the move is not kept, and keeps nothing", async () => {
    const { io, kept } = fakeFileIo();
    mount(io, false);
    await act(async () => drag({ x: 0, y: 120 }));
    expect(screen.getByTestId("structured-arrangement-note").textContent).toBe("This arrangement is not kept: the document is outside the writable zone.");
    expect(kept).toHaveLength(0);
  });

  it("an arrangement that cannot be read is named, and the graph is laid out without it", async () => {
    const { io } = fakeFileIo("{ not json");
    mount(io);
    await waitFor(() => expect(screen.getByTestId("structured-arrangement-note").textContent).toBe("The arrangement beside this document is not used: it is not parseable JSON."));
  });

  it("the check is shown beside the figure when the arrangement leaves something to look at", async () => {
    const arrangement: Arrangement = {
      format: "pi-outpost/structured-exchange-arrangement-1",
      views: { "": { elements: { "id:battery": { x: 20, y: 40 }, "id:inverter": { x: 220, y: 40 }, "id:motor": { x: 420, y: 40 }, "id:gone": { x: 620, y: 40 } }, relationships: {} } },
    };
    const { io } = fakeFileIo(writeArrangement(arrangement));
    mount(io);
    const check = await screen.findByTestId("structured-arrangement-check");
    expect(check.textContent).toContain("1 thing to look at in this arrangement");
    expect(check.textContent).toContain('the arrangement places "id:gone", which the document no longer holds');
  });
});
