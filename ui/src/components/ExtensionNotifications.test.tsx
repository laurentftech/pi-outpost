import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExtensionNotifications } from "./ExtensionNotifications";
import type { ExtensionNotification } from "../useAgent";

describe("ExtensionNotifications", () => {
  it("returns null when empty", () => {
    const { container } = render(<ExtensionNotifications notifications={[]} onDismiss={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders toasts", () => {
    const notifications: ExtensionNotification[] = [
      { id: "1", message: "Info message", notifyType: "info" },
      { id: "2", message: "Warning message", notifyType: "warning" },
    ];
    render(<ExtensionNotifications notifications={notifications} onDismiss={vi.fn()} />);
    expect(screen.getByText("Info message")).toBeInTheDocument();
    expect(screen.getByText("Warning message")).toBeInTheDocument();
  });

  it("applies correct styles per type", () => {
    const nfo: ExtensionNotification[] = [{ id: "1", message: "Info", notifyType: "info" }];
    const warn: ExtensionNotification[] = [{ id: "2", message: "Warning", notifyType: "warning" }];
    const err: ExtensionNotification[] = [{ id: "3", message: "Error", notifyType: "error" }];

    const { container: c1 } = render(<ExtensionNotifications notifications={nfo} onDismiss={vi.fn()} />);
    const { container: c2 } = render(<ExtensionNotifications notifications={warn} onDismiss={vi.fn()} />);
    const { container: c3 } = render(<ExtensionNotifications notifications={err} onDismiss={vi.fn()} />);

    const t1 = c1.querySelector("[class*='border-blue']");
    const t2 = c2.querySelector("[class*='border-amber']");
    const t3 = c3.querySelector("[class*='border-red']");
    expect(t1).toBeInTheDocument();
    expect(t2).toBeInTheDocument();
    expect(t3).toBeInTheDocument();
  });

  it("auto-dismisses after 6 seconds", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<ExtensionNotifications notifications={[{ id: "1", message: "Auto", notifyType: "info" }]} onDismiss={onDismiss} />);
    vi.advanceTimersByTime(6000);
    expect(onDismiss).toHaveBeenCalledWith("1");
    vi.useRealTimers();
  });
});
