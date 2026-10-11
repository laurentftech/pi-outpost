/**
 * A document edited beside its rendering.
 *
 * The claim under test is not "two panes appear". It is that the picture is of the
 * text in the editor — including text nobody has saved — and that it survives the
 * state that text spends most of its time in while someone types, which is
 * unparseable. A diagram that vanishes on every keystroke is worse than one that
 * is briefly out of date, so what is asserted is the rendering *staying*, not an
 * error being absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { STRUCTURED_EXCHANGE_SCHEMA_V1 as S } from "@pi-outpost/shared/structured-exchange";
import { FileViewer } from "./FileViewer";
import type { OpenFile } from "../useAgent";
import { editorElement, editorText, typeInEditor } from "./codeEditorTesting";

const documentOf = (batteryLabel: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify(
    {
      schema: S,
      kind: "graph",
      data: {
        nodes: [
          { id: "batt", label: batteryLabel, kind: "power" },
          { id: "ecu", label: "Calculateur", kind: "compute" },
        ],
        edges: [{ from: "batt", to: "ecu", label: "400V", kind: "power" }],
      },
      ...extra,
    },
    null,
    2,
  );

const VALID = documentOf("Batterie");

type Props = React.ComponentProps<typeof FileViewer>;

function setup(content = VALID, overrides: Partial<Props> = {}, path = "diagrams/architecture.json") {
  const file: OpenFile = { status: "loaded", path, content, size: content.length, mtimeMs: 1000 };
  const handlers = {
    onDirtyChange: vi.fn(),
    onFetchGitDiff: vi.fn(),
    onClearGitDiff: vi.fn(),
    onOpenGitHistory: vi.fn(),
    onClose: vi.fn(),
    onReload: vi.fn(),
    onSave: vi.fn(),
    onImageLoad: vi.fn(),
  };
  const props: Props = { file, isStreaming: false, gitDiff: null, gitAvailable: false, ...handlers, ...overrides };
  const view = render(<FileViewer {...props} />);
  return { ...handlers, ...view };
}

/** Enter the mode the way a reader does. */
const chooseSplit = () => fireEvent.click(screen.getByRole("button", { name: /split/ }));

/** Type into the editor, then let the debounce elapse. */
function type(text: string) {
  typeInEditor(text);
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

/** The labels the rendering currently draws. */
const drawn = () =>
  [...(screen.queryByTestId("file-split-rendering")?.querySelectorAll("svg text") ?? [])].map((t) => t.textContent);

describe("editing a document beside its rendering", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom ships no matchMedia, and the mode asks it whether there is room for two
    // panes. Answering yes here is what the fallback test below overrides.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the document and its picture at the same time", () => {
    setup();
    chooseSplit();
    const split = screen.getByTestId("file-split");
    // Both halves, in one view: the text to change and the picture to read.
    expect(editorElement(split)).not.toBeNull();
    expect(within(split).getByTestId("file-structured-exchange")).toBeInTheDocument();
    expect(drawn()).toContain("Batterie");
  });

  it("draws what is in the editor, not what is on disk", () => {
    // Nothing is saved here. A reader who has saved nothing has still changed the
    // model in front of them, and a picture of the file would be a picture of a
    // document that no longer exists in the session.
    const { onSave } = setup();
    chooseSplit();

    type(documentOf("Batterie 800V"));

    expect(drawn()).toContain("Batterie 800V");
    expect(drawn()).not.toContain("Batterie");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the last good picture while the text does not parse", () => {
    setup();
    chooseSplit();
    type(documentOf("Batterie 800V"));

    type('{ "schema": "urn:structured-exchange:1", "kind": "gra');

    // The picture stays, and it is the one that was last good — not the file's.
    expect(screen.getByTestId("file-structured-exchange")).toBeInTheDocument();
    expect(drawn()).toContain("Batterie 800V");
    expect(screen.getByTestId("file-split-stale")).toBeInTheDocument();
  });

  it("keeps it while the text parses and fails the schema, too", () => {
    setup();
    chooseSplit();

    type(JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{}], edges: [] } }));

    expect(drawn()).toContain("Batterie");
    expect(screen.getByTestId("file-split-stale")).toBeInTheDocument();
  });

  it("takes the marker away again when the text comes back", () => {
    setup();
    chooseSplit();
    type("{ broken");
    expect(screen.getByTestId("file-split-stale")).toBeInTheDocument();

    type(documentOf("Batterie 800V"));

    expect(screen.queryByTestId("file-split-stale")).toBeNull();
    expect(drawn()).toContain("Batterie 800V");
  });

  it("says why for text that does not parse — the state typing spends most of its time in", () => {
    // Found by typing in the running application: the stale marker appeared and the
    // reason beside it was empty, because unparseable text produces no issue list.
    // A half-finished keystroke is the commonest reason a picture goes stale, and
    // it was the one case that said nothing.
    setup();
    chooseSplit();

    type('{ "schema": "urn:structured-exchange:1", "kind": "gra');

    expect(screen.getByTestId("file-split-stale")).toHaveTextContent("not parseable JSON");
  });

  it("says so when the text stops declaring the schema at all", () => {
    setup();
    chooseSplit();

    type(JSON.stringify({ kind: "graph", data: { nodes: [], edges: [] } }));

    expect(screen.getByTestId("file-split-stale")).toHaveTextContent("no longer declares");
  });

  it("says why the text is refused, without leaving the mode", () => {
    setup();
    chooseSplit();

    type(JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{ label: "no id" }], edges: [] } }));

    const issues = screen.getByTestId("file-split-issues");
    expect(issues.textContent).not.toBe("");
    // Still in the mode: the editor and the picture are both still there.
    expect(editorElement()).not.toBeNull();
    expect(screen.getByTestId("file-structured-exchange")).toBeInTheDocument();
  });

  it("prefers the reference validator's reasons only while the buffer matches the file", () => {
    // The server's diagnosis describes the file on disk. Once the buffer differs it
    // is about text nobody is looking at any more.
    const broken = JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{}], edges: [] } });
    const file: OpenFile = {
      status: "loaded",
      path: "diagrams/broken.json",
      content: broken,
      size: broken.length,
      mtimeMs: 1000,
      documentIssues: [{ rule: "schema/required", path: "/data/nodes/0", message: "must have required property 'id'" }],
    };
    setup(broken, { file });
    chooseSplit();

    expect(screen.getByTestId("file-split-issues")).toHaveTextContent("must have required property 'id'");

    type(JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{ id: "" }], edges: [] } }));

    expect(screen.getByTestId("file-split-issues")).not.toHaveTextContent("must have required property 'id'");
  });

  it("draws nothing for a document that was already invalid when it was opened", () => {
    // No stale picture carried in from anywhere: this file never had a good one.
    const broken = JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{}], edges: [] } });
    setup(broken, {}, "diagrams/broken.json");
    chooseSplit();

    expect(screen.queryByTestId("file-structured-exchange")).toBeNull();
    expect(screen.queryByTestId("file-split-stale")).toBeNull();
    expect(screen.getByTestId("file-split-issues")).toBeInTheDocument();
    expect(screen.getByText(/Nothing to draw yet/)).toBeInTheDocument();
  });

  it("saves through the same path as any other edit, mtime and all", () => {
    const { onSave } = setup();
    chooseSplit();
    const next = documentOf("Batterie 800V");
    type(next);

    fireEvent.click(screen.getByRole("button", { name: "save" }));

    // The baseline the editor started from travels with it: that is the guard the
    // server uses to refuse a write onto a file that moved underneath.
    expect(onSave).toHaveBeenCalledWith("diagrams/architecture.json", next, 1000, false);
  });

  it("offers no editor outside the writable zone, and still pairs with the picture", () => {
    setup(VALID, { writableRoot: null });
    chooseSplit();

    expect(screen.getByTestId("file-split")).toBeInTheDocument();
    expect(screen.getByTestId("file-structured-exchange")).toBeInTheDocument();
    expect(editorElement()).toBeNull();
    expect(screen.getByText("🔒 read-only")).toBeInTheDocument();
  });

  it("asks before dropping unsaved changes on the way out of the mode", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    setup();
    chooseSplit();
    type(documentOf("Batterie 800V"));

    fireEvent.click(screen.getByRole("button", { name: /rendered/ }));

    expect(confirm).toHaveBeenCalled();
    // Refused, so nothing was dropped: still in the mode, still holding the text.
    expect(screen.getByTestId("file-split")).toBeInTheDocument();
    expect(editorText()).toBe(documentOf("Batterie 800V"));
  });

  it("cancelling discards the draft and keeps the mode", () => {
    // Raised by review. Cancelling used to leave the editor null while the mode
    // stayed "split", so the writable half turned read-only: the effect that opens
    // the editor watches the mode, not the buffer, and never fired again.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    setup();
    chooseSplit();
    type(documentOf("Batterie 800V"));

    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    // The picture follows on the same debounce as any other change to the buffer.
    act(() => {
      vi.advanceTimersByTime(400);
    });

    expect(screen.getByTestId("file-split")).toBeInTheDocument();
    // Still writable, and back to what is on disk.
    expect(editorText()).toBe(VALID);
    expect(drawn()).toContain("Batterie");
  });

  it("offers no side-by-side mode for a file it does not recognise", () => {
    setup(JSON.stringify({ kind: "graph", data: { nodes: [], edges: [] } }), {}, "diagrams/plain.json");
    expect(screen.queryByRole("button", { name: /split/ })).toBeNull();
  });

  it("offers it for a document that declares the contract and fails it", () => {
    // The mode is where someone goes to fix one; refusing it there would shut the
    // door on the case it is most wanted for.
    setup(JSON.stringify({ schema: S, kind: "graph", data: { nodes: [{}], edges: [] } }), {}, "diagrams/broken.json");
    expect(screen.getByRole("button", { name: /split/ })).toBeInTheDocument();
  });

  it("keeps the editor, not the layout, when the room runs out mid-edit", () => {
    // The other ordering, and the one the first test could not see: entering the
    // mode wide opens a buffer, and narrowing afterwards must not discard it to
    // honour a layout rule. Found by resizing the running application.
    let matches = true;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => {
        // The viewer's layout query only: the editor listens for "print" too.
        if (query !== "print") listeners.push(fn);
      },
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    const listeners: (() => void)[] = [];

    setup();
    chooseSplit();
    const edited = documentOf("Batterie 800V");
    type(edited);

    act(() => {
      matches = false;
      for (const fn of listeners) fn();
    });

    expect(screen.queryByTestId("file-split")).toBeNull();
    // The unsaved text is still there, and still the reader's to save.
    expect(editorText()).toBe(edited);
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
  });

  it("falls back to the rendering when there is no room for two panes", () => {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    setup();

    chooseSplit();

    expect(screen.queryByTestId("file-split")).toBeNull();
    // Not a blank half-screen: the rendering the mode extends is what shows.
    expect(screen.getByTestId("file-structured-exchange")).toBeInTheDocument();
  });

  describe("Markdown, which has a rendering too", () => {
    const MD = "# Vehicle\n\nThe power path.\n";

    it("shows the source and the rendering at the same time", () => {
      setup(MD, {}, "reports/vehicle.md");
      chooseSplit();

      const split = screen.getByTestId("file-split");
      expect(editorElement(split)).not.toBeNull();
      expect(within(split).getByRole("heading", { name: "Vehicle" })).toBeInTheDocument();
    });

    it("renders what is in the editor, not what is on disk", () => {
      const { onSave } = setup(MD, {}, "reports/vehicle.md");
      chooseSplit();

      type("## Revised\n\nThe traction path.\n");

      const split = screen.getByTestId("file-split");
      expect(within(split).getByRole("heading", { name: "Revised" })).toBeInTheDocument();
      expect(within(split).queryByRole("heading", { name: "Vehicle" })).toBeNull();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("resolves a figure reference the same way it does at full width", () => {
      // The reason the renderer is shared rather than written twice: a figure that
      // loaded in one mode and not the other is the exact confusion the rendering
      // exists to avoid.
      setup("![Power train](figures/power.svg)\n", { token: "t" }, "reports/q3/vehicle.md");
      chooseSplit();

      const image = within(screen.getByTestId("file-split")).getByRole("img", { name: "Power train" });
      const source = new URL(image.getAttribute("src")!, "http://host");
      expect(source.pathname).toBe("/files/raw");
      expect(source.searchParams.get("path")).toBe("reports/q3/figures/power.svg");
      expect(source.searchParams.get("token")).toBe("t");
    });

    it("never goes stale, because there is no text it cannot render", () => {
      setup(MD, {}, "reports/vehicle.md");
      chooseSplit();

      // Text that would be refused outright as a structured-exchange document is
      // simply a paragraph here.
      type("{ this is not json at all");

      expect(screen.queryByTestId("file-split-stale")).toBeNull();
      expect(screen.queryByTestId("file-split-issues")).toBeNull();
      // Scoped to the rendering half: the editor holds the same text, so an
      // unscoped query matches the source and proves nothing about the picture.
      expect(within(screen.getByTestId("file-split-rendering")).getByText(/this is not json at all/)).toBeInTheDocument();
    });

    it("replaces the toggle it used to have rather than sitting beside it", () => {
      setup(MD, {}, "reports/vehicle.md");
      const group = screen.getByRole("group", { name: "How to show this document" });
      expect(within(group).getAllByRole("button")).toHaveLength(3);
      // The old two-state control is gone: one way to say what you are looking at.
      expect(screen.queryByTitle("Show source")).toBeNull();
    });

    it("still offers nothing for a file with no rendering", () => {
      setup("const a = 1;\n", {}, "src/main.ts");
      expect(screen.queryByRole("group", { name: "How to show this document" })).toBeNull();
    });
  });
});