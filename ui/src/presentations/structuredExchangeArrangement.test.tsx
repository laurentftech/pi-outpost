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
import { DRAWIO_MESSAGE } from "../util/drawioPage";
import type { DocumentExport } from "./documentExport";
import { figureForEnvelope } from "@pi-outpost/shared/structured-exchange/export";

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

describe("the figure that leaves", () => {
  // openlore: scenario=TheSameArrangedPictureWithoutADisplay spec=structured-exchange
  it("TheSameArrangedPictureWithoutADisplay: the SVG downloaded and the one written without a browser draw the same places and routes", async () => {
    const arrangement: Arrangement = {
      format: "pi-outpost/structured-exchange-arrangement-1",
      views: { "": { elements: { "id:battery": { x: 40, y: 300 }, "id:inverter": { x: 260, y: 300 }, "id:motor": { x: 260, y: 460 } }, relationships: {} } },
    };
    const { io } = fakeFileIo(writeArrangement(arrangement));
    const exportRef: { current: DocumentExport | null } = { current: null };
    render(
      <DrawioFilesContext.Provider value={{ serverUrl: "", fileIo: io }}>
        <StructuredExchangeDocument envelope={envelope} source={SOURCE} file={{ path: "models/car.json", writable: true }} exportRef={exportRef} />
      </DrawioFilesContext.Provider>,
    );
    await waitFor(() => expect(firstBox()).toEqual({ x: 40, y: 300 }));

    const created: Blob[] = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return "blob:figure";
    };
    URL.revokeObjectURL = () => {};
    try {
      exportRef.current!.svg!();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    expect(created).toHaveLength(1);
    const downloaded = await created[0]!.text();
    const written = figureForEnvelope(envelope, { arrangement });
    expect(written.ok).toBe(true);
    const drawing = (svg: string) => ({
      boxes: [...svg.matchAll(/data-element-id="([^"]+)"[^>]*>\s*(?:<title>[^<]*<\/title>\s*)?<rect[^>]*?\bx="(-?[\d.]+)"[^>]*?\by="(-?[\d.]+)"/g)].map((match) => `${match[1]} ${match[2]} ${match[3]}`).sort(),
      routes: [...svg.matchAll(/<path[^>]*data-edge="line"[^>]*\bd="([^"]+)"|<path[^>]*\bd="([^"]+)"[^>]*data-edge="line"/g)].map((match) => match[1] ?? match[2]).sort(),
    });
    const fromBrowser = drawing(downloaded);
    expect(fromBrowser.boxes).toHaveLength(3);
    expect(fromBrowser.routes).toHaveLength(2);
    expect(fromBrowser).toEqual(drawing((written as { svg: string }).svg));
  });
});

describe("arranging in draw.io's touch-up", () => {
  /** The touch-up frame, answering as the vendored viewer does. */
  async function touchUpFrame() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const element = screen.getByTitle("Arrange in draw.io") as HTMLIFrameElement;
    const own = element.contentWindow!;
    const sent = vi.spyOn(own, "postMessage");
    const answer = (data: Record<string, unknown>) => act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source: own }));
    });
    answer({ type: DRAWIO_MESSAGE.READY });
    answer({ type: DRAWIO_MESSAGE.RENDERED, pages: 1 });
    return { sent, answer };
  }

  // openlore: scenario=ATouchUpIsReadBackByIdentity spec=structured-exchange-arrangement
  it("ATouchUpIsReadBackByIdentity: the page touched up comes back into the arrangement by identity, kept beside the document", async () => {
    const { io, kept } = fakeFileIo();
    mount(io);
    fireEvent.click(screen.getByRole("button", { name: "✎ arrange in draw.io" }));
    const { sent, answer } = await touchUpFrame();
    // What the frame is given to draw is the figure's own page, cells named by identity
    const render = sent.mock.calls.map(([message]) => message as { type: string; xml?: string }).find((message) => message.xml !== undefined);
    expect(render?.xml).toContain('id="n:battery"');
    const keep = screen.getByRole("button", { name: "✓ keep" });
    expect(keep).toBeDisabled();
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    fireEvent.click(keep);
    // The motor dragged to (500, 300), the text of the inverter edited: the place is kept, the text is not
    const model = /<mxGraphModel>[\s\S]*<\/mxGraphModel>/.exec(render!.xml!)![0]
      .replace(/(<mxCell id="n:motor"[^>]*>\s*<mxGeometry\b)[^>]*?(width=)/, '$1 x="500" y="300" $2')
      .replace(/(<mxCell id="n:inverter" value=")Inverter(")/, "$1Onduleur$2");
    answer({ type: DRAWIO_MESSAGE.SAVED, page: 0, xml: model });
    await waitFor(() => expect(kept).toHaveLength(1));
    const reading = readArrangement(kept[0]!.content);
    expect((reading as { arrangement: Arrangement }).arrangement.views[""]!.elements["id:motor"]).toEqual({ x: 500, y: 300 });
    expect(screen.getByTestId("structured-arrangement-note").textContent).toBe(
      'Kept the arrangement. Not kept: the text of "Inverter" was changed to "Onduleur": the document\'s text is not changed from here.',
    );
    // Marked clean, the frame says so; then leaving draws the graph with what was kept
    await waitFor(() => expect(sent.mock.calls.map(([message]) => (message as { type: string }).type)).toContain(DRAWIO_MESSAGE.CLEAN));
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: false, canUndo: true, canRedo: false });
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    await waitFor(() => expect(screen.queryByTestId("structured-touchup")).toBeNull());
    const motor = [...document.querySelectorAll('[data-draggable="node"]')].find((node) => node.textContent?.includes("Motor"))!.querySelector("rect")!;
    expect({ x: Number(motor.getAttribute("x")), y: Number(motor.getAttribute("y")) }).toEqual({ x: 500, y: 300 });
  });

  it("is not offered for a document outside the writable zone", () => {
    const { io } = fakeFileIo();
    mount(io, false);
    expect(screen.queryByRole("button", { name: "✎ arrange in draw.io" })).toBeNull();
  });
});

describe("the transitions around arranging (task 7.2)", () => {
  const graphWith = (nodes: Array<{ id: string; label: string; kind?: string }>, edges: Array<{ from: string; to: string; kind: string }>, viewpoints?: unknown[]) => {
    const outcome = parseStructuredExchange(
      { schema: viewpoints === undefined ? "urn:structured-exchange:1" : "urn:structured-exchange:2", kind: "graph", ...(viewpoints === undefined ? {} : { viewpoints }), data: { nodes, edges } },
      checkStructuredExchangeSchemaInBrowser,
    );
    if (!outcome.valid) throw new Error(JSON.stringify(outcome.issues));
    return outcome.envelope as ValidatedStructuredExchange;
  };
  const view = (io: FileIo, shown: ValidatedStructuredExchange) => (
    <DrawioFilesContext.Provider value={{ serverUrl: "", fileIo: io }}>
      <StructuredExchangeDocument envelope={shown} source={SOURCE} file={{ path: "models/car.json", writable: true }} />
    </DrawioFilesContext.Provider>
  );
  async function frameAnswering() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const element = screen.getByTitle("Arrange in draw.io") as HTMLIFrameElement;
    const own = element.contentWindow!;
    const sent = vi.spyOn(own, "postMessage");
    const answer = (data: Record<string, unknown>) => act(() => {
      window.dispatchEvent(new MessageEvent("message", { data, source: own }));
    });
    answer({ type: DRAWIO_MESSAGE.READY });
    answer({ type: DRAWIO_MESSAGE.RENDERED, pages: 1 });
    const drawn = () => sent.mock.calls.map(([message]) => message as { xml?: string }).filter((message) => message.xml !== undefined).at(-1)?.xml ?? "";
    return { sent, answer, drawn };
  }

  it("done pressed while a keep is in flight leaves once it has landed, without asking", async () => {
    const confirm = vi.spyOn(window, "confirm");
    let release!: () => void;
    const { io, kept } = fakeFileIo();
    io.keepArrangement = (documentPath, content) => new Promise((resolve) => {
      release = () => { kept.push({ documentPath, content }); resolve("models/car.arrangement.json"); };
    });
    mount(io);
    fireEvent.click(screen.getByRole("button", { name: "✎ arrange in draw.io" }));
    const { answer, drawn } = await frameAnswering();
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    fireEvent.click(screen.getByRole("button", { name: "✓ keep" }));
    answer({ type: DRAWIO_MESSAGE.SAVED, page: 0, xml: /<mxGraphModel>[\s\S]*<\/mxGraphModel>/.exec(drawn())![0] });
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId("structured-touchup")).toBeTruthy();
    // The keep lands: kept, and only then is the touch-up left
    await waitFor(() => expect(release).toBeDefined());
    await act(async () => release());
    await waitFor(() => expect(screen.queryByTestId("structured-touchup")).toBeNull());
    expect(kept).toHaveLength(1);
  });

  it("a touch-up opened on the whole document is kept for the whole document, and the viewpoint cannot be switched under it", async () => {
    const shown = graphWith(
      [{ id: "battery", label: "Battery", kind: "source" }, { id: "inverter", label: "Inverter", kind: "converter" }, { id: "ecu", label: "ECU", kind: "controller" }],
      [{ from: "battery", to: "inverter", kind: "power" }, { from: "ecu", to: "inverter", kind: "signal" }],
      [{ id: "power", label: "Power", concern: "Energy", elementKinds: ["source", "converter"], relationshipKinds: ["power"] }],
    );
    const { io, kept } = fakeFileIo();
    render(view(io, shown));
    fireEvent.click(screen.getByRole("button", { name: "✎ arrange in draw.io" }));
    expect(screen.getByTestId("viewpoint-select")).toBeDisabled();
    expect(screen.getByTestId("diagram-orientation")).toBeDisabled();
    const { answer, drawn } = await frameAnswering();
    answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    fireEvent.click(screen.getByRole("button", { name: "✓ keep" }));
    answer({ type: DRAWIO_MESSAGE.SAVED, page: 0, xml: /<mxGraphModel>[\s\S]*<\/mxGraphModel>/.exec(drawn())![0] });
    await waitFor(() => expect(kept).toHaveLength(1));
    expect(Object.keys((readArrangement(kept[0]!.content) as { arrangement: Arrangement }).arrangement.views)).toEqual([""]);
  });

  it("the document changed on disk mid touch-up: drawn afresh when nothing is pending, said and filtered when something is", async () => {
    const { io, kept } = fakeFileIo();
    const first = render(view(io, envelope));
    fireEvent.click(screen.getByRole("button", { name: "✎ arrange in draw.io" }));
    const { answer, drawn } = await frameAnswering();
    // Nothing pending: the charger the document now holds is in the touch-up
    const charged = graphWith([...DOCUMENT.data.nodes, { id: "charger", label: "Charger" }], [...DOCUMENT.data.edges, { from: "charger", to: "battery", kind: "power" }]);
    first.rerender(view(io, charged));
    const again = await frameAnswering();
    expect(again.drawn()).toContain('id="n:charger"');

    // Touch-ups pending, then the motor removed on disk: said, and the motor's place is not kept
    again.answer({ type: DRAWIO_MESSAGE.CHANGED, dirty: true, canUndo: true, canRedo: false });
    const shrunk = graphWith(DOCUMENT.data.nodes.filter((node) => node.id !== "motor").concat({ id: "charger", label: "Charger" }), [DOCUMENT.data.edges[0]!, { from: "charger", to: "battery", kind: "power" }]);
    first.rerender(view(io, shrunk));
    expect(await screen.findByTestId("structured-touchup-changed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "✓ keep" }));
    again.answer({ type: DRAWIO_MESSAGE.SAVED, page: 0, xml: /<mxGraphModel>[\s\S]*<\/mxGraphModel>/.exec(again.drawn())![0] });
    await waitFor(() => expect(kept).toHaveLength(1));
    const elements = (readArrangement(kept[0]!.content) as { arrangement: Arrangement }).arrangement.views[""]!.elements;
    expect(Object.keys(elements).sort()).toEqual(["id:battery", "id:charger", "id:inverter"]);
    void answer;
    void drawn;
  });
});
