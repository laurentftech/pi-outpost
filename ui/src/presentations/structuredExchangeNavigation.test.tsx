/**
 * Following a link a producer wrote — and what must not happen before a reader asks.
 *
 * A validated document is not a trusted one. Its locations and artifact URIs were
 * written by whatever produced it, and the one thing this application must never do
 * is treat their arrival as permission to act: no fetch, no open, no resolution
 * while the document is merely being read. The reader's click is the first thing
 * that touches the other end.
 *
 * When they do click, they go only where this application already lets anyone go —
 * a file inside the workspace, through the same confined surface, or an `http(s)`
 * address through the browser's own external path. Anything else is shown in full
 * and followed by nothing. That is not censorship: the URI stays on screen and
 * stays selectable, because a reader may well need to act on it elsewhere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StructuredExchangeDocument } from "./StructuredExchangeView";
import { validStructuredExchange } from "./structuredExchange";
import type { ToolAction } from "./types";

const V2 = "urn:structured-exchange:2";

/** One requirement, carrying whatever location or artifact the case needs. */
function documentWith(over: { locations?: unknown[]; artifacts?: unknown[] }) {
  return {
    schema: V2,
    kind: "table",
    data: {
      columns: ["id", "requirement"],
      rows: [{ id: "r1", ref: "REQ-1", kind: "requirement", cells: ["REQ-1", "Stop within 40 m"], ...over }],
    },
  };
}

const digest = `sha256:${"a".repeat(64)}`;

function show(document: unknown, dispatch: (action: ToolAction) => void = vi.fn()) {
  const serialized = JSON.stringify(document);
  const envelope = validStructuredExchange(serialized);
  expect(envelope, "the fixture itself does not validate").toBeDefined();
  render(<StructuredExchangeDocument envelope={envelope!} source={serialized} dispatch={dispatch} />);
  // The detail is folded by default, exactly as a reader meets it.
  const panel = screen.getByTestId("structured-enrichment");
  fireEvent.click(panel.querySelector("summary")!);
  return panel;
}

describe("nothing is reached for before the reader asks", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders a location and an artifact without fetching either", () => {
    // The document names an https artifact and a workspace file. Drawing it must
    // touch neither: a producer's URI is not a request this application makes on
    // their behalf the moment their document arrives.
    show(
      documentWith({
        locations: [{ uri: "workspace:specs/brakes.md", range: { startLine: 10, endLine: 12 } }],
        artifacts: [{ rel: "verifies", uri: "https://ci.example/report.json", sha256: digest }],
      }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks the application for nothing until a control is used", () => {
    const dispatch = vi.fn();
    show(documentWith({ locations: [{ uri: "workspace:specs/brakes.md" }] }), dispatch);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not open an artifact's bytes to show that it has a digest", () => {
    const panel = show(documentWith({ artifacts: [{ rel: "verifies", uri: "https://ci.example/r.json", sha256: digest }] }));
    // The digest is shown because the document carries it, not because anything
    // here hashed what is at the other end.
    expect(panel.textContent).toContain("sha256");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("where a reader may be taken", () => {
  it("offers a workspace file through the application's own confined surface", () => {
    const dispatch = vi.fn();
    const panel = show(documentWith({ locations: [{ uri: "workspace:specs/brakes.md" }] }), dispatch);

    const control = panel.querySelector('[data-followable="workspace-file"]')!;
    expect(control).toBeTruthy();
    fireEvent.click(control);

    // The closed set of actions a presentation may request — it names one, it never
    // constructs a message or reaches the filesystem itself.
    expect(dispatch).toHaveBeenCalledWith({ kind: "openFile", path: "specs/brakes.md" });
  });

  it("offers an http address as an ordinary external link", () => {
    const panel = show(documentWith({ artifacts: [{ rel: "verifies", uri: "https://ci.example/report.json", sha256: digest }] }));
    const link = panel.querySelector('a[data-followable="external-url"]') as HTMLAnchorElement;
    expect(link?.getAttribute("href")).toBe("https://ci.example/report.json");
    expect(link?.getAttribute("rel")).toContain("noreferrer");
  });

  it("follows a bare relative path, which is what a producer writes for a sibling file", () => {
    const dispatch = vi.fn();
    const panel = show(documentWith({ locations: [{ uri: "specs/brakes.md" }] }), dispatch);
    fireEvent.click(panel.querySelector('[data-followable="workspace-file"]')!);
    expect(dispatch).toHaveBeenCalledWith({ kind: "openFile", path: "specs/brakes.md" });
  });
});

describe("where a reader may not", () => {
  const refused = [
    ["a scheme the policy does not allow", "file:///etc/passwd"],
    ["one that would execute", "javascript:alert(1)"],
    ["an authority of its own", "doors://module/42"],
    ["an absolute path", "/etc/passwd"],
    ["a windows path", "C:\\\\Windows\\\\system32"],
    ["a path climbing out of the workspace", "../../etc/passwd"],
  ] as const;

  for (const [name, uri] of refused) {
    it(`shows ${name} without offering to follow it`, () => {
      const dispatch = vi.fn();
      const panel = show(documentWith({ locations: [{ uri }] }), dispatch);

      // Shown in full: the reader may need to act on it somewhere this application
      // has no business going.
      expect(panel.textContent).toContain(uri);
      expect(panel.querySelector('[data-followable="workspace-file"]')).toBeNull();
      expect(panel.querySelector('[data-followable="external-url"]')).toBeNull();
      expect(panel.querySelector("a")).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    });
  }

  it("offers nothing at all when there is no conversation to act on", () => {
    // The file viewer renders a document with no dispatch behind it. A location is
    // then text, which is the same answer an unsupported scheme gets.
    const serialized = JSON.stringify(documentWith({ locations: [{ uri: "workspace:specs/brakes.md" }] }));
    const envelope = validStructuredExchange(serialized);
    render(<StructuredExchangeDocument envelope={envelope!} source={serialized} />);
    const panel = screen.getByTestId("structured-enrichment");
    fireEvent.click(panel.querySelector("summary")!);
    expect(panel.querySelector('[data-followable="workspace-file"]')).toBeNull();
    expect(panel.textContent).toContain("workspace:specs/brakes.md");
  });
});
