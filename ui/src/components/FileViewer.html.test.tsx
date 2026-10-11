import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileViewer } from "./FileViewer";
import type { OpenFile } from "../useAgent";

type Props = React.ComponentProps<typeof FileViewer>;

const PAGE = '<link rel="stylesheet" href="css/site.css"><img id="logo" src="logo.png"><script src="app.js"></script><h1>Report</h1>';

function open(overrides: Partial<Props> = {}) {
  const file: OpenFile = { status: "loaded", path: "site/index.html", content: PAGE, size: PAGE.length, mtimeMs: 1000 };
  const props: Props = {
    file,
    isStreaming: false,
    gitDiff: null,
    inRepository: false,
    serverUrl: "http://127.0.0.1:9",
    token: "secret-token",
    workspace: "p1",
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

describe("an HTML file in the viewer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens rendered, its resources fetched by the viewer with the token, none of it in the page", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(url);
        const path = new URL(url).searchParams.get("path");
        if (path === "site/css/site.css") return new Response("h1 { color: rgb(1, 2, 3); }");
        if (path === "site/app.js") throw new TypeError("network down");
        return new Response("missing", { status: 404 });
      }),
    );
    open();
    const frame = await screen.findByTestId("html-page");
    const srcdoc = frame.getAttribute("srcdoc")!;
    expect(srcdoc).toContain("h1 { color: rgb(1, 2, 3); }");
    // A 404 and a failed fetch leave the reference as written, as a browser shows it broken.
    expect(srcdoc).toContain('src="logo.png"');
    expect(srcdoc).toContain('src="app.js"');
    expect(srcdoc).not.toContain("secret-token");
    expect(fetched).toHaveLength(3);
    for (const url of fetched) {
      expect(new URL(url).pathname).toBe("/files/raw");
      expect(new URL(url).searchParams.get("token")).toBe("secret-token");
      expect(new URL(url).searchParams.get("workspace")).toBe("p1");
    }
  });

  it("shows its source on request, and the rendering again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    open();
    await screen.findByTestId("html-page");
    fireEvent.click(screen.getByRole("button", { name: /source/ }));
    expect(screen.queryByTestId("html-page")).toBeNull();
    expect(screen.getByText(/Report/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /rendered/ }));
    expect(await screen.findByTestId("html-page")).toBeInTheDocument();
  });
});
