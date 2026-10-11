import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HtmlPageFrame, PAGE_SANDBOX } from "./HtmlPageFrame";
import { OPEN_MESSAGE, type LoadFile } from "../util/htmlPage";

const noFiles: LoadFile = async () => undefined;

function post(data: unknown, source: MessageEventSource | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

describe("HtmlPageFrame", () => {
  it("draws the prepared page in a sandbox without the same origin", async () => {
    const load: LoadFile = async (path) => (path === "site/style.css" ? new Blob(["h1 { color: red; }"]) : undefined);
    render(<HtmlPageFrame source={'<link rel="stylesheet" href="style.css"><h1>Hi</h1>'} path="site/index.html" load={load} onOpen={() => {}} />);
    expect(screen.getByTestId("html-page-loading")).toBeInTheDocument();
    const frame = await screen.findByTestId("html-page");
    expect(frame).toHaveAttribute("sandbox", PAGE_SANDBOX);
    expect(PAGE_SANDBOX).not.toContain("allow-same-origin");
    expect(frame.getAttribute("srcdoc")).toContain("h1 { color: red; }");
    expect(frame).toHaveAttribute("title", "site/index.html");
  });

  it("still draws the page, without its resources, when it cannot be prepared", async () => {
    const failing = vi.fn<LoadFile>();
    const parse = vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementationOnce(() => {
      throw new Error("unparsable");
    });
    render(<HtmlPageFrame source="<p>raw</p>" path="a.html" load={failing} onOpen={() => {}} />);
    expect((await screen.findByTestId("html-page")).getAttribute("srcdoc")).toBe("<p>raw</p>");
    parse.mockRestore();
  });

  it("opens a relative link the page asks for, resolved against the page, and only from its own frame", async () => {
    const onOpen = vi.fn();
    render(<HtmlPageFrame source="<p>page</p>" path="site/index.html" load={noFiles} onOpen={onOpen} />);
    const frame = (await screen.findByTestId("html-page")) as HTMLIFrameElement;
    const own = frame.contentWindow;
    expect(own).not.toBeNull();

    // Anything but the page's own frame: the application's window, or no source at all.
    post({ type: OPEN_MESSAGE, href: "notes.md" }, window);
    post({ type: OPEN_MESSAGE, href: "notes.md" }, null);
    // The page's frame, with the wrong shape.
    post(null, own);
    post("notes.md", own);
    post({ type: "other", href: "notes.md" }, own);
    post({ type: OPEN_MESSAGE, href: 42 }, own);
    expect(onOpen).not.toHaveBeenCalled();

    post({ type: OPEN_MESSAGE, href: "../docs/notes.md" }, own);
    expect(onOpen).toHaveBeenCalledWith("docs/notes.md");
  });

  it("stops listening once gone, and drops a preparation that lands after it", async () => {
    let finish: (blob: Blob | undefined) => void = () => {};
    const slow: LoadFile = () => new Promise((resolve) => (finish = resolve));
    const onOpen = vi.fn();
    const { unmount } = render(<HtmlPageFrame source={'<img src="a.png">'} path="a.html" load={slow} onOpen={onOpen} />);
    unmount();
    await act(async () => finish(undefined));
    post({ type: OPEN_MESSAGE, href: "b.md" }, window);
    await waitFor(() => expect(onOpen).not.toHaveBeenCalled());
  });
});
