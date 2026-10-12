/**
 * The Word export, as the reader reaches it.
 *
 * The claim under test is not "a button appears". It is that the button is offered
 * exactly where the export means something, that it carries the text the reader is
 * *looking at* rather than the text on disk, and that pressing it changes nothing
 * about the document underneath — no save, no closed viewer, no lost draft.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { OpenFile } from "../useAgent";
import { editorText, typeInEditor } from "./codeEditorTesting";

type ExportCall = { text: string; path: string; options?: { serverUrl?: string; token?: string | null } };

const exported = vi.hoisted(() => ({
  calls: [] as ExportCall[],
  fail: null as Error | null,
  templateCalls: [] as ExportCall[],
  templateFail: null as Error | null,
}));

vi.mock("../export/docxExport", () => ({
  downloadDocx: async (text: string, path: string, options?: ExportCall["options"]) => {
    exported.calls.push({ text, path, options });
    if (exported.fail !== null) throw exported.fail;
  },
  downloadDocxInTemplate: async (text: string, path: string, options?: ExportCall["options"]) => {
    exported.templateCalls.push({ text, path, options });
    if (exported.templateFail !== null) throw exported.templateFail;
  },
}));

const workbooks = vi.hoisted(() => ({ names: [] as string[], rows: [] as number[] }));
vi.mock("../presentations/tableExport", async (importOriginal) => {
  const original = await importOriginal<typeof import("../presentations/tableExport")>();
  return {
    ...original,
    downloadXlsx: async (table: { rows: unknown[] }, fileName: string) => {
      workbooks.names.push(fileName);
      workbooks.rows.push(table.rows.length);
    },
  };
});

type Props = React.ComponentProps<typeof FileViewer>;

function setup(overrides: Partial<Props> = {}, file?: Partial<OpenFile>) {
  const base: OpenFile = {
    status: "loaded",
    path: "notes.md",
    content: "# Title\n\nBody.\n",
    size: 16,
    mtimeMs: 1000,
    ...(file as object),
  } as OpenFile;
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
  const props: Props = {
    file: base,
    isStreaming: false,
    gitDiff: null,
    inRepository: false,
    ...handlers,
    ...overrides,
  };
  return { ...handlers, ...render(<FileViewer {...props} />) };
}

const exportButton = () => screen.queryByRole("button", { name: /download as a word document/i });

describe("where the export is offered", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers it for a markdown file", () => {
    setup();

    expect(exportButton()).not.toBeNull();
  });

  it("offers it for a text file that is not markdown", () => {
    setup({}, { path: "server.log", content: "a log line\n" });

    expect(exportButton()).not.toBeNull();
  });

  it("offers it for a read-only file, because a download is not a write", () => {
    // The writable zone governs saving. Taking a copy away is not saving, so a file
    // the reader may not edit is still a file they may keep.
    setup({ writableRoot: null });

    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    expect(exportButton()).not.toBeNull();
  });

  it("offers it in source mode as well as rendered", () => {
    setup();

    fireEvent.click(screen.getByRole("button", { name: /source/ }));

    // It exports the document, not the view: the mode the reader happens to be in
    // does not change what the document is.
    expect(exportButton()).not.toBeNull();
  });

  it("does not offer it for an image", () => {
    setup({}, { path: "diagram.png", content: "" });

    expect(exportButton()).toBeNull();
  });

  it("does not offer it for a PDF", () => {
    setup({}, { path: "report.pdf", content: "" });

    expect(exportButton()).toBeNull();
  });

  it("does not offer it for a file that failed to load", () => {
    setup({ file: { status: "error", path: "gone.md", message: "not found" } as OpenFile });

    expect(exportButton()).toBeNull();
  });

  it("does not offer it while the uncommitted diff is showing", () => {
    // The reader is looking at changes, not at the document; exporting "the
    // document" from here would hand over something they are not looking at.
    setup({ gitState: "modified", initialShowGitDiff: true, gitDiff: null });

    expect(exportButton()).toBeNull();
  });
});

describe("what the export carries", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
  });

  it("sends the file's text and its path", async () => {
    setup();

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    expect(exported.calls[0]).toMatchObject({ text: "# Title\n\nBody.\n", path: "notes.md" });
  });

  it("sends the origin and token the viewer reads this file through", async () => {
    // Without these the export has no way to fetch the figures the document
    // references, and every one of them would come out as its alt text — which is
    // exactly what it did before they were passed.
    setup({ serverUrl: "http://localhost:3141", token: "t0ken" });

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    expect(exported.calls[0].options).toEqual({ serverUrl: "http://localhost:3141", token: "t0ken" });
  });

  it("sends the unsaved draft, not the text on disk", async () => {
    // What the reader is looking at is the draft — the rendering beside it is drawn
    // from the draft too. An export of the saved file would hand over a document
    // that no longer exists in this session.
    setup();
    fireEvent.click(screen.getByRole("button", { name: /edit/ }));
    typeInEditor("# Edited\n\nNew body.\n");

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    expect(exported.calls[0].text).toBe("# Edited\n\nNew body.\n");
  });

  it("leaves the viewer exactly as it was", async () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole("button", { name: /edit/ }));
    typeInEditor("# Edited\n");

    fireEvent.click(exportButton()!);
    await waitFor(() => expect(exported.calls).toHaveLength(1));

    // Nothing saved, nothing closed, and the draft is still in the editor with its
    // unsaved marker showing.
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(editorText()).toBe("# Edited\n");
  });
});

describe("while it is working, and when it fails", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
  });

  it("says so when the export cannot be produced, and downloads nothing", async () => {
    // A failure that looked like success would leave the reader waiting for a file
    // that is never coming.
    exported.fail = new Error("the writer refused");
    setup();

    fireEvent.click(exportButton()!);

    await waitFor(() => expect(screen.getByRole("button", { name: /download as a word/i })).toHaveTextContent(/failed/i));
    expect(screen.getByRole("button", { name: /download as a word/i }).title).toContain("the writer refused");
  });

  it("shows that it is working, and goes back to itself afterwards", async () => {
    // A button that looks idle while a large document is being built reads as a
    // button that did nothing, and the reader presses it again.
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const module = await import("../export/docxExport");
    vi.spyOn(module, "downloadDocx").mockImplementation(async () => {
      await slow;
    });
    setup();
    const button = exportButton()!;

    fireEvent.click(button);

    await waitFor(() => expect(button).toHaveTextContent(/exporting/i));
    expect(button).toBeDisabled();

    release();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).toHaveTextContent(/word/i);
  });

  it("ignores a second press while the first is still running", async () => {
    // Two exports race for mermaid's global configuration, and the reader gets two
    // identical downloads for one intention.
    let release: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const module = await import("../export/docxExport");
    vi.spyOn(module, "downloadDocx").mockImplementation(async (text: string, path: string) => {
      exported.calls.push({ text, path });
      await slow;
    });
    setup();

    fireEvent.click(exportButton()!);
    fireEvent.click(exportButton()!);
    fireEvent.click(exportButton()!);

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    release();
  });
});

describe("with a configured Word template", () => {
  beforeEach(() => {
    exported.calls.length = 0;
    exported.fail = null;
    exported.templateCalls.length = 0;
    exported.templateFail = null;
  });

  const plain = () => screen.getByRole("button", { name: "Download as a Word document" });
  const inTemplate = () => screen.queryByRole("button", { name: /in the template/i });

  it("ExportUsesTheConfiguredTemplate: offers the template export beside the plain one, and sends the document through it", async () => {
    setup({ docxTemplate: "house.dotx", serverUrl: "http://127.0.0.1:4322", token: "t0k" });

    expect(inTemplate()).not.toBeNull();
    expect(inTemplate()!.title).toContain("house.dotx");
    fireEvent.click(inTemplate()!);

    await waitFor(() => expect(exported.templateCalls).toHaveLength(1));
    expect(exported.templateCalls[0]).toEqual({ text: "# Title\n\nBody.\n", path: "notes.md", options: { serverUrl: "http://127.0.0.1:4322", token: "t0k" } });
    expect(exported.calls).toHaveLength(0);
  });

  it("WithoutATemplateTheExportIsUnchanged: one export, the plain one", async () => {
    setup();

    expect(inTemplate()).toBeNull();
    expect(screen.getAllByRole("button", { name: /download as a word document/i })).toHaveLength(1);
    fireEvent.click(plain());
    await waitFor(() => expect(exported.calls).toHaveLength(1));
    expect(exported.templateCalls).toHaveLength(0);
  });

  it("the other export pressed straight after one finishes is not taken for a double-click", async () => {
    // A template export can come back in a couple of hundred milliseconds. The guard
    // against the second half of a double-click once covered both buttons, and the plain
    // export pressed right after it was silently dropped.
    setup({ docxTemplate: "house.dotx" });

    fireEvent.click(inTemplate()!);
    await waitFor(() => expect(exported.templateCalls).toHaveLength(1));
    await waitFor(() => expect(plain()).not.toBeDisabled());
    fireEvent.click(plain());

    await waitFor(() => expect(exported.calls).toHaveLength(1));
    // The same button pressed again at once is still one intention.
    fireEvent.click(plain());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(exported.calls).toHaveLength(1);
  });

  it("ABrokenTemplateDoesNotBlockThePlainExport: the template export says why, and the plain one still works", async () => {
    exported.templateFail = new Error("The Word template house.dotx cannot be read.");
    setup({ docxTemplate: "house.dotx" });

    fireEvent.click(inTemplate()!);

    await waitFor(() => expect(inTemplate()).toHaveTextContent(/export failed/i));
    expect(inTemplate()!.title).toContain("The Word template house.dotx cannot be read.");
    // The failure is shown where it happened, not on the plain export.
    expect(plain()).toHaveTextContent("⤓ word");
    expect(plain()).not.toBeDisabled();

    // Straight away: the other button is another intention, not the end of a double-click.
    fireEvent.click(plain());
    await waitFor(() => expect(exported.calls).toHaveLength(1));
    await waitFor(() => expect(plain()).toHaveTextContent("⤓ word"));
    expect(plain()).not.toHaveTextContent(/failed/i);
  });
});

describe("a structured-exchange file exports what it draws", () => {
  const sample = (name: string) => readFileSync(path.join(__dirname, "../../../shared/conformance/valid", name), "utf8");
  const svgButton = () => screen.queryByRole("button", { name: "Download the figure as SVG" });
  const excelButton = () => screen.queryByRole("button", { name: "Download as an Excel workbook" });

  beforeEach(() => {
    exported.calls.length = 0;
    workbooks.names.length = 0;
    workbooks.rows.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers a figure as SVG from the toolbar, and not as Word text", () => {
    const content = sample("graph-minimal.json");
    setup({}, { path: "figures/arch.json", content, size: content.length });

    expect(exportButton()).toBeNull();
    expect(excelButton()).toBeNull();
    const clicked: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = realCreate(tag);
      if (tag === "a") element.click = () => clicked.push(element.getAttribute("download") ?? "");
      return element;
    });
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = () => {};

    fireEvent.click(svgButton()!);

    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/\.svg$/);
  });

  it("offers a timeline as SVG too", () => {
    const content = sample("v3-timeline-calendar.json");
    setup({}, { path: "plans/programme.json", content, size: content.length });
    expect(svgButton()).not.toBeNull();
    expect(exportButton()).toBeNull();
  });

  it("offers a table as a Word table and an Excel workbook, not as a figure", async () => {
    const content = sample("table-minimal.json");
    setup({}, { path: "data/requirements.json", content, size: content.length });

    expect(svgButton()).toBeNull();
    fireEvent.click(excelButton()!);
    expect(workbooks.names).toHaveLength(1);
    expect(workbooks.names[0]).toMatch(/\.xlsx$/);

    fireEvent.click(exportButton()!);
    await waitFor(() => expect(exported.calls).toHaveLength(1));
    // Written from the rows as Markdown, so the writer makes a Word table of them.
    expect(exported.calls[0]!.path).toBe("data/requirements.md");
    expect(exported.calls[0]!.text).toMatch(/^\|.*\|$/m);
    expect(exported.calls[0]!.text).not.toContain("urn:structured-exchange");
  });

  it("offers nothing for the document's source, which is JSON", () => {
    const content = sample("graph-minimal.json");
    setup({}, { path: "figures/arch.json", content, size: content.length });
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(svgButton()).toBeNull();
    expect(exportButton()).toBeNull();
  });

  it("still offers Word for a Markdown file", () => {
    setup();
    expect(exportButton()).not.toBeNull();
    expect(svgButton()).toBeNull();
  });
});

