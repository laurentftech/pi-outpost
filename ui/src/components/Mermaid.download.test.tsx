import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Mermaid } from "./Mermaid";

const drawing = vi.hoisted(() => vi.fn());
const exporting = vi.hoisted(() => vi.fn());
vi.mock("mermaid", () => ({ default: { initialize() {}, render: drawing } }));
vi.mock("../export/mermaidToImage", () => ({ renderDiagram: exporting }));

describe("Mermaid downloads", () => {
  let click: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    drawing.mockReset().mockResolvedValue({ svg: '<svg viewBox="0 0 400 200"></svg>' });
    exporting.mockReset().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><text>Start</text></svg>' });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:diagram"), revokeObjectURL: vi.fn() }));
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("DownloadTheShownMermaid: exports the orientation shown and keeps authored source available", async () => {
    render(<Mermaid code={'flowchart LR\n A[Start] --> B[End]'} />);
    await screen.findByRole("button", { name: /download SVG/ });
    fireEvent.click(screen.getByTestId("mermaid-orientation"));
    await waitFor(() => expect(screen.getByTestId("mermaid-orientation")).toHaveAccessibleName("Turn the diagram landscape"));
    fireEvent.click(screen.getByRole("button", { name: /download SVG/ }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(exporting.mock.calls[0][0]).toMatch(/flowchart (TD|TB)/);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:diagram");
    fireEvent.click(screen.getByRole("button", { name: "⌗ code" }));
    expect(screen.getByText(/flowchart LR/).textContent).toBe('flowchart LR\n A[Start] --> B[End]');
  });

  it("FailedMermaidDownloadCanBeRetried: reports failure, enables retry and keeps the diagram", async () => {
    exporting.mockRejectedValueOnce(new Error("cannot draw"));
    render(<Mermaid code="flowchart LR\n A --> B" />);
    fireEvent.click(await screen.findByRole("button", { name: /download SVG/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cannot draw");
    expect(screen.getByRole("button", { name: /download SVG/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /download SVG/ }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("AMermaidDownloadCannotOutliveItsSource: prevents duplicate downloads and drops a replaced source", async () => {
    let finish!: (value: { svg: string }) => void;
    exporting.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { rerender } = render(<Mermaid code="flowchart LR\n A --> B" />);
    const button = await screen.findByRole("button", { name: /download SVG/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(exporting).toHaveBeenCalledOnce());
    rerender(<Mermaid code="flowchart LR\n C --> D" />);
    finish({ svg: "<svg></svg>" });
    await screen.findByRole("button", { name: /download SVG/ });
    expect(click).not.toHaveBeenCalled();
  });
});
