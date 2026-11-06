import React, { Suspense, createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DrawioPainter, type DrawioPainterHandle } from "./DrawioPainter";

const frame = vi.hoisted(() => ({ exportSvg: vi.fn<() => Promise<{ svg: string }>>() }));
vi.mock("./DrawioFrame", async () => {
  const ReactModule = await import("react");
  return {
    DrawioFrame: ReactModule.forwardRef(function FakeDrawioFrame(props: Record<string, unknown>, ref: React.Ref<unknown>) {
      ReactModule.useImperativeHandle(ref, () => ({ exportSvg: frame.exportSvg }));
      return <div data-testid="fake-frame" data-xml={props.xml as string}>
        <button type="button" onClick={() => (props.onRendered as (failure: string | null) => void)(null)}>rendered</button>
        <button type="button" onClick={() => (props.onRendered as (failure: string | null) => void)("invalid diagram")}>failed</button>
      </div>;
    }),
  };
});

function harness() {
  const ref = createRef<DrawioPainterHandle>();
  const resolved = vi.fn();
  const rejected = vi.fn();
  const view = render(<><button onClick={() => void ref.current!.draw("<mxGraphModel/>").then(resolved, rejected)}>Draw</button><Suspense fallback="loading"><DrawioPainter ref={ref} serverUrl="http://localhost:3000" /></Suspense></>);
  return { ref, resolved, rejected, unmount: view.unmount };
}

afterEach(() => {
  vi.useRealTimers();
  frame.exportSvg.mockReset();
});

describe("DrawioPainter", () => {
  it("exports the rendered page and removes the off-screen frame when finished", async () => {
    frame.exportSvg.mockResolvedValue({ svg: "<svg/>" });
    const { resolved, rejected } = harness();
    fireEvent.click(screen.getByRole("button", { name: "Draw" }));
    await waitFor(() => expect(screen.getByTestId("drawio-painter")).toHaveStyle({ left: "-20000px" }));
    expect(screen.getByTestId("fake-frame")).toHaveAttribute("data-xml", "<mxGraphModel/>");
    fireEvent.click(screen.getByText("rendered"));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith("<svg/>"));
    expect(rejected).not.toHaveBeenCalled();
    expect(screen.queryByTestId("drawio-painter")).not.toBeInTheDocument();
  });

  it("rejects a viewer render error and continues the serialized queue", async () => {
    frame.exportSvg.mockResolvedValue({ svg: "<svg/>" });
    const { ref, resolved, rejected } = harness();
    const first = ref.current!.draw("first").then(resolved, rejected);
    const second = ref.current!.draw("second").then(resolved, rejected);
    await waitFor(() => expect(screen.getByTestId("fake-frame")).toHaveAttribute("data-xml", "first"));
    fireEvent.click(screen.getByText("failed"));
    await waitFor(() => expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ message: "invalid diagram" })));
    await waitFor(() => expect(screen.getByTestId("fake-frame")).toHaveAttribute("data-xml", "second"));
    fireEvent.click(screen.getByText("rendered"));
    await waitFor(() => expect(resolved).toHaveBeenCalledWith("<svg/>"));
    await Promise.all([first, second]);
  });

  it("turns export rejections into errors and rejects a pending draw when unmounted", async () => {
    frame.exportSvg.mockRejectedValue("export failed");
    const { ref, unmount } = harness();
    const unmountResult = ref.current!.draw("export").catch((error: Error) => error.message);
    await waitFor(() => expect(screen.getByTestId("fake-frame")).toHaveAttribute("data-xml", "export"));
    fireEvent.click(screen.getByText("rendered"));
    await expect(unmountResult).resolves.toBe("export failed");

    const next = ref.current!.draw("pending").catch((error: Error) => error.message);
    await waitFor(() => expect(screen.getByTestId("fake-frame")).toHaveAttribute("data-xml", "pending"));
    act(() => unmount());
    await expect(next).resolves.toBe("the poster was closed");
  });

  it("rejects a viewer that does not answer before the timeout", async () => {
    vi.useFakeTimers();
    const { ref } = harness();
    const pending = ref.current!.draw("slow");
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await expect(pending).rejects.toThrow("the draw.io viewer did not answer");
  });
});
