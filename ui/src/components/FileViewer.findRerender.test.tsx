import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { GitDiffState, OpenFile } from "../useAgent";

/**
 * The real CodeHighlight renders the file as plain text, then — once
 * highlight.js has loaded — replaces that whole `<pre>` with highlighted
 * markup. Find-in-page marks the rendered text directly, so that swap lands
 * underneath an active search and everything about it (when it happens,
 * whether the reader has already navigated) is timing.
 *
 * This fake reproduces the two phases on demand instead of on a promise, so a
 * test can put the swap exactly where it wants it: after the reader has
 * stepped to a later match. On a warm machine highlight.js resolves before
 * anyone can type, which is why this only ever failed on CI.
 */
let triggerHighlight: (() => void) | undefined;

vi.mock("./CodeHighlight", async () => {
  const { memo, useState } = await import("react");
  return {
    // Memoized, like the real one — and for the same reason: React re-applies
    // a `dangerouslySetInnerHTML` element's DOM on every render of the
    // component that owns it, wiping marks a caller put there. An unmemoized
    // fake would fail this test for a reason the real component does not have.
    CodeHighlight: memo(function FakeCodeHighlight({
      code,
      onRendered,
    }: {
      code: string;
      path: string;
      onRendered?: () => void;
    }) {
      const [highlighted, setHighlighted] = useState(false);
      triggerHighlight = () => {
        setHighlighted(true);
        onRendered?.();
      };
      if (!highlighted) return <pre className="whitespace-pre-wrap">{code}</pre>;
      // The real component swaps to dangerouslySetInnerHTML, which replaces
      // the element's whole DOM — including marks applied to the plain phase.
      return <pre className="hljs" dangerouslySetInnerHTML={{ __html: code.replace(/[<>&]/g, "") }} />;
    }),
  };
});

vi.mock("./PdfViewer", () => ({ default: () => <div data-testid="pdf-viewer" /> }));

function loadedFile(overrides: Partial<Extract<OpenFile, { status: "loaded" }>> = {}): OpenFile {
  return { status: "loaded", path: "src/main.ts", content: "fox fox fox", size: 11, mtimeMs: 1000, ...overrides };
}

type Props = React.ComponentProps<typeof FileViewer>;

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    file: loadedFile(),
    isStreaming: false,
    gitDiff: null as GitDiffState | null,
    inRepository: false,
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

const ctrlF = () => fireEvent.keyDown(document, { key: "f", ctrlKey: true });
const findInput = () => screen.getByLabelText("Find") as HTMLInputElement;

describe("find-in-page when the content is re-rendered underneath it", () => {
  beforeEach(() => {
    triggerHighlight = undefined;
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the reader on the match they navigated to", async () => {
    setup();
    ctrlF();
    fireEvent.change(findInput(), { target: { value: "fox" } });
    await waitFor(() => expect(screen.getByText("1/3")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Next match"));
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(screen.getByText("3/3")).toBeInTheDocument();

    // Syntax highlighting lands, replacing the text the marks were applied to.
    act(() => triggerHighlight?.());

    await waitFor(() => {
      expect(document.querySelectorAll("mark.find-match")).toHaveLength(3);
      expect(document.querySelectorAll("mark.find-match-current")).toHaveLength(1);
    });
    expect(screen.getByText("3/3")).toBeInTheDocument();
  });

  it("still answers the next click after the swap", async () => {
    setup();
    ctrlF();
    fireEvent.change(findInput(), { target: { value: "fox" } });
    await waitFor(() => expect(screen.getByText("1/3")).toBeInTheDocument());

    act(() => triggerHighlight?.());
    await waitFor(() => expect(document.querySelectorAll("mark.find-match")).toHaveLength(3));

    fireEvent.click(screen.getByLabelText("Next match"));

    await waitFor(() => expect(screen.getByText("2/3")).toBeInTheDocument());
    expect(document.querySelectorAll("mark.find-match-current")).toHaveLength(1);
  });
});
