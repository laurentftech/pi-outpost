import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { OpenFile } from "../useAgent";

vi.mock("./PdfViewer", () => ({
  default: ({ path, token }: { path: string; token: string | null }) => (
    <div data-testid="pdf-viewer" data-path={path} data-token={token ?? ""} />
  ),
}));

type Props = React.ComponentProps<typeof FileViewer>;

/** A PDF as the preview protocol reports it: refused, because it is binary. */
function pdfFile(path = "docs/report.pdf"): OpenFile {
  return { status: "error", path, message: "Binary file — preview not supported" };
}

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    file: pdfFile(),
    isStreaming: false,
    gitDiff: null,
    gitAvailable: false,
    onDirtyChange: vi.fn(),
    onFetchGitDiff: vi.fn(),
    onClearGitDiff: vi.fn(),
    onOpenGitHistory: vi.fn(),
    onClose: vi.fn(),
    onReload: vi.fn(),
    onSave: vi.fn(),
    onImageLoad: vi.fn(),
    ...overrides,
  };
  return render(<FileViewer {...props} />);
}

describe("FileViewer with a PDF", () => {
  it("renders the PDF instead of the binary-file refusal", async () => {
    setup();

    expect(await screen.findByTestId("pdf-viewer")).toHaveAttribute("data-path", "docs/report.pdf");
    expect(screen.queryByText(/Binary file/)).toBeNull();
  });

  it("passes the auth token down so the viewer can fetch the bytes", async () => {
    setup({ token: "secret-token" });

    expect(await screen.findByTestId("pdf-viewer")).toHaveAttribute("data-token", "secret-token");
  });

  it("offers no edit action, even inside the writable zone", async () => {
    setup({ writableRoot: undefined });

    await screen.findByTestId("pdf-viewer");
    expect(screen.queryByRole("button", { name: "✎ edit" })).toBeNull();
  });

  it("still closes like any other file", async () => {
    const onClose = vi.fn();
    setup({ onClose });

    await screen.findByTestId("pdf-viewer");
    screen.getByRole("button", { name: "Close file viewer" }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
