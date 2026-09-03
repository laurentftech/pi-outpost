import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TerminalPanel } from "./TerminalPanel";
import { ThemeContext } from "../theme/ThemeContext";
import { Terminal } from "@xterm/xterm";

describe("TerminalPanel", () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    cwd: "/test/project",
    openTerminal: vi.fn(),
    sendTerminalInput: vi.fn(),
    getTerminalCwd: vi.fn(),
    resizeTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    subscribeTerminal: vi.fn(() => () => {}),
  };

  it("is not rendered initially before being opened", () => {
    const { container } = render(<TerminalPanel {...defaultProps} open={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("is hidden with CSS class when minimized without unmounting", () => {
    const { container, rerender } = render(<TerminalPanel {...defaultProps} open={true} />);
    expect(container.firstChild).toHaveClass("flex");

    rerender(<TerminalPanel {...defaultProps} open={false} />);
    expect(container.firstChild).toHaveClass("hidden");
  });

  it("renders tabs and controls when open", () => {
    render(
      <ThemeContext.Provider value="dark">
        <TerminalPanel {...defaultProps} />
      </ThemeContext.Provider>,
    );

    expect(screen.getByText("terminal 1")).toBeInTheDocument();
    expect(screen.getByTitle("New Terminal Tab")).toBeInTheDocument();
    expect(screen.getByTitle("Clear Terminal Output")).toBeInTheDocument();
    expect(screen.getByTitle(/Maximize Terminal Panel/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Minimize Terminal Panel/i)).toBeInTheDocument();
  });

  it("calls openTerminal with initial tab id", () => {
    const openTerminal = vi.fn();
    render(<TerminalPanel {...defaultProps} openTerminal={openTerminal} />);

    expect(openTerminal).toHaveBeenCalledWith(
      "term-1",
      "/test/project",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("adds a new tab when clicking + button", () => {
    const openTerminal = vi.fn();
    render(<TerminalPanel {...defaultProps} openTerminal={openTerminal} />);

    const addButton = screen.getByTitle("New Terminal Tab");
    fireEvent.click(addButton);

    expect(screen.getByText("terminal 2")).toBeInTheDocument();
    expect(openTerminal).toHaveBeenCalledTimes(2);
  });

  it("allows renaming tabs on double click", () => {
    render(<TerminalPanel {...defaultProps} />);

    const tab = screen.getByText("terminal 1");
    fireEvent.doubleClick(tab);

    const input = screen.getByDisplayValue("terminal 1");
    fireEvent.change(input, { target: { value: "API Server" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("API Server")).toBeInTheDocument();
  });

  it("does not let the terminal take focus back while a tab is being renamed", async () => {
    // The flake this fixes, as a defect rather than a race: a tab becoming active
    // schedules `terminal.focus()` 50 ms later, and double-clicking to rename also
    // activates. The timer landed mid-typing, the input blurred, `onBlur` committed, and
    // the field was unmounted from under whoever was typing — with a half-written name.
    vi.useFakeTimers();
    const focusSpy = vi.spyOn(Terminal.prototype, "focus").mockImplementation(() => {});
    try {
      render(<TerminalPanel {...defaultProps} />);
      focusSpy.mockClear();

      fireEvent.doubleClick(screen.getByText("terminal 1"));
      const input = screen.getByDisplayValue("terminal 1");
      fireEvent.change(input, { target: { value: "Build Ser" } });

      // Everything the focus timer would have fired, while the name is half typed.
      act(() => void vi.advanceTimersByTime(500));
      expect(focusSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId("terminal-tab-rename-input")).toBe(input);

      fireEvent.change(input, { target: { value: "Build Server" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(screen.getByText("Build Server")).toBeInTheDocument();
    } finally {
      focusSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("calls onSetWorkspaceRoot when clicking open as project button", () => {
    const onSetWorkspaceRoot = vi.fn();
    render(
      <TerminalPanel
        {...defaultProps}
        cwd="/custom/subproject"
        onSetWorkspaceRoot={onSetWorkspaceRoot}
      />,
    );

    const syncButton = screen.getByTitle(/as the workspace project and reposition the LLM agent/i);
    fireEvent.click(syncButton);

    expect(onSetWorkspaceRoot).toHaveBeenCalledWith("/custom/subproject");
  });

  it("toggles maximize panel height", () => {
    render(<TerminalPanel {...defaultProps} />);

    const maxButton = screen.getByTitle("Maximize Terminal Panel");
    fireEvent.click(maxButton);

    expect(screen.getByTitle("Restore Terminal Panel")).toBeInTheDocument();

    const restoreButton = screen.getByTitle("Restore Terminal Panel");
    fireEvent.click(restoreButton);

    expect(screen.getByTitle("Maximize Terminal Panel")).toBeInTheDocument();
  });

  it("calls onClose when clicking minimize button", () => {
    const onClose = vi.fn();
    render(<TerminalPanel {...defaultProps} onClose={onClose} />);

    const closeButton = screen.getByTitle(/Minimize Terminal Panel/i);
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it("handles tab renaming with Escape key and empty string", () => {
    render(<TerminalPanel {...defaultProps} />);

    const tab = screen.getByText("terminal 1");
    fireEvent.doubleClick(tab);

    const input = screen.getByDisplayValue("terminal 1");
    // Press Escape to cancel
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByText("terminal 1")).toBeInTheDocument();

    // Double click again and submit whitespace
    fireEvent.doubleClick(screen.getByText("terminal 1"));
    const input2 = screen.getByDisplayValue("terminal 1");
    fireEvent.change(input2, { target: { value: "   " } });
    fireEvent.keyDown(input2, { key: "Enter" });
    expect(screen.getByText("terminal 1")).toBeInTheDocument();
  });

  it("handles tab closing and active tab switching", () => {
    render(<TerminalPanel {...defaultProps} />);

    const addButton = screen.getByTitle("New Terminal Tab");
    fireEvent.click(addButton);
    fireEvent.click(addButton);

    expect(screen.getByText("terminal 1")).toBeInTheDocument();
    expect(screen.getByText("terminal 2")).toBeInTheDocument();
    expect(screen.getByText("terminal 3")).toBeInTheDocument();

    // Close buttons for tabs
    const closeButtons = screen.getAllByRole("button", { name: "Close terminal tab" });
    expect(closeButtons.length).toBeGreaterThan(0);

    // Close the active 3rd tab
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    expect(screen.queryByText("terminal 3")).not.toBeInTheDocument();
    expect(screen.getByText("terminal 2")).toBeInTheDocument();
  });

  it("handles terminal subscriptions: onData, onCwd, OSC 7, onExit, onError", () => {
    let capturedCallbacks: any;
    const subscribeTerminal = vi.fn((_id, callbacks) => {
      capturedCallbacks = callbacks;
      return () => {};
    });

    const writelnSpy = vi.spyOn(Terminal.prototype, "writeln");

    render(
      <TerminalPanel
        {...defaultProps}
        onSetWorkspaceRoot={vi.fn()}
        subscribeTerminal={subscribeTerminal}
      />,
    );

    expect(subscribeTerminal).toHaveBeenCalled();
    expect(capturedCallbacks).toBeDefined();

    // Test onData
    act(() => {
      capturedCallbacks.onData("normal output\n");
    });

    // Test onData with OSC 7 directory notification
    act(() => {
      capturedCallbacks.onData("\x1b]7;file://localhost/Users/developer/project/nested/deep/path\x07");
    });
    expect(screen.getByText(/nested\/deep\/path/)).toBeInTheDocument();

    // Test onCwd
    act(() => {
      capturedCallbacks.onCwd("/var/www/html");
    });
    expect(screen.getByText(/var\/www\/html/)).toBeInTheDocument();

    // Test onExit: contract is to output formatted exit message to the terminal
    act(() => {
      capturedCallbacks.onExit(0);
    });
    expect(writelnSpy).toHaveBeenCalledWith(expect.stringContaining("[Process completed (exit code 0)]"));

    act(() => {
      capturedCallbacks.onExit(1);
    });
    expect(writelnSpy).toHaveBeenCalledWith(expect.stringContaining("[Process completed (exit code 1)]"));

    // Test onError: contract is to output red error notice to the terminal
    act(() => {
      capturedCallbacks.onError("connection lost");
    });
    expect(writelnSpy).toHaveBeenCalledWith(expect.stringContaining("[Terminal error: connection lost]"));

    writelnSpy.mockRestore();
  });

  it("handles root filesystem confirmation prompt when syncing", () => {
    const onSetWorkspaceRoot = vi.fn();
    const originalConfirm = window.confirm;

    let capturedCallbacks: any;
    const subscribeTerminal = vi.fn((_id, callbacks) => {
      capturedCallbacks = callbacks;
      return () => {};
    });

    render(
      <TerminalPanel
        {...defaultProps}
        cwd="/"
        onSetWorkspaceRoot={onSetWorkspaceRoot}
        subscribeTerminal={subscribeTerminal}
      />,
    );

    // User cancels confirm
    window.confirm = vi.fn(() => false);
    const syncButton = screen.getByTitle(/as the workspace project/i);
    fireEvent.click(syncButton);
    expect(onSetWorkspaceRoot).not.toHaveBeenCalled();

    // User accepts confirm
    window.confirm = vi.fn(() => true);
    fireEvent.click(syncButton);
    expect(onSetWorkspaceRoot).toHaveBeenCalledWith("/");

    window.confirm = originalConfirm;
  });

  it("handles clear terminal action", () => {
    const clearSpy = vi.spyOn(Terminal.prototype, "clear");
    render(<TerminalPanel {...defaultProps} />);

    const clearButton = screen.getByTitle("Clear Terminal Output");
    fireEvent.click(clearButton);

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("handles clicking tabs to switch active tab", () => {
    render(<TerminalPanel {...defaultProps} />);

    const addButton = screen.getByTitle("New Terminal Tab");
    fireEvent.click(addButton);

    // Tab 2 is active initially; Tab 1 is inactive
    const tab1 = screen.getByText("terminal 1");
    const tab2 = screen.getByText("terminal 2");
    const tab1Container = tab1.closest("[title='Double-click to rename tab']");
    const tab2Container = tab2.closest("[title='Double-click to rename tab']");

    expect(tab2Container).toHaveClass("font-medium");
    expect(tab1Container).not.toHaveClass("font-medium");

    // Click tab 1 to switch back
    fireEvent.click(tab1);

    expect(tab1Container).toHaveClass("font-medium");
    expect(tab2Container).not.toHaveClass("font-medium");
  });

  it("toggles theme dynamically", () => {
    let capturedTerminal: any;
    const origOpen = Terminal.prototype.open;
    const openSpy = vi.spyOn(Terminal.prototype, "open").mockImplementation(function (this: any, el: HTMLElement) {
      capturedTerminal = this;
      return origOpen.call(this, el);
    });

    const { rerender } = render(
      <ThemeContext.Provider value="light">
        <TerminalPanel {...defaultProps} />
      </ThemeContext.Provider>,
    );

    expect(capturedTerminal).toBeDefined();
    expect(capturedTerminal.options.theme?.background).toBe("#ffffff");

    rerender(
      <ThemeContext.Provider value="dark">
        <TerminalPanel {...defaultProps} />
      </ThemeContext.Provider>,
    );

    expect(capturedTerminal.options.theme?.background).toBe("#09090b");
    openSpy.mockRestore();
  });

  it("does not render a close button when only one tab exists", () => {
    render(<TerminalPanel {...defaultProps} />);
    expect(screen.queryByRole("button", { name: "Close terminal tab" })).not.toBeInTheDocument();
  });

  it("routes typed keystrokes to sendTerminalInput and throttles cwd requests on Enter", () => {
    vi.useFakeTimers();
    let capturedOnData: ((data: string) => void) | undefined;
    const origOpen = Terminal.prototype.open;
    const openSpy = vi.spyOn(Terminal.prototype, "open").mockImplementation(function (this: any, el: HTMLElement) {
      Object.defineProperty(this, "onData", {
        value: (cb: (data: string) => void) => {
          capturedOnData = cb;
          return { dispose: vi.fn() };
        },
        configurable: true,
      });
      return origOpen.call(this, el);
    });

    const sendTerminalInput = vi.fn();
    const getTerminalCwd = vi.fn();

    render(
      <TerminalPanel
        {...defaultProps}
        sendTerminalInput={sendTerminalInput}
        getTerminalCwd={getTerminalCwd}
      />,
    );

    expect(capturedOnData).toBeDefined();
    // Mount effect requests cwd once; clear to isolate keystroke behavior
    expect(getTerminalCwd).toHaveBeenCalledTimes(1);
    getTerminalCwd.mockClear();

    // 1. Regular keystroke without Enter
    act(() => {
      capturedOnData!("echo hello");
    });
    expect(sendTerminalInput).toHaveBeenCalledWith("term-1", "echo hello");
    expect(getTerminalCwd).not.toHaveBeenCalled();

    // 2. Press Enter (\r): forwards keystroke and immediately requests cwd
    act(() => {
      capturedOnData!("\r");
    });
    expect(sendTerminalInput).toHaveBeenCalledWith("term-1", "\r");
    expect(getTerminalCwd).toHaveBeenCalledTimes(1);
    expect(getTerminalCwd).toHaveBeenCalledWith("term-1");

    // 3. Press Enter again immediately (<1000ms): keystroke is forwarded, cwd query is throttled
    act(() => {
      capturedOnData!("\r");
    });
    expect(sendTerminalInput).toHaveBeenLastCalledWith("term-1", "\r");
    expect(getTerminalCwd).toHaveBeenCalledTimes(1);

    // Another Enter while debounce timer is already pending: does not spawn duplicate timer
    act(() => {
      capturedOnData!("\n");
    });
    expect(getTerminalCwd).toHaveBeenCalledTimes(1);

    // 4. Advance time by 1000ms: catch-up timer fires cwd query
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getTerminalCwd).toHaveBeenCalledTimes(2);

    openSpy.mockRestore();
    vi.useRealTimers();
  });

  it("refits and calls resizeTerminal when ResizeObserver triggers", () => {
    let capturedResizeCallback: (() => void) | undefined;
    class TestResizeObserver {
      constructor(cb: () => void) {
        capturedResizeCallback = cb;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);

    const resizeTerminal = vi.fn();
    const { container } = render(
      <TerminalPanel {...defaultProps} resizeTerminal={resizeTerminal} />,
    );

    expect(capturedResizeCallback).toBeDefined();

    const termContainer = container.querySelector(".flex-1.min-h-0.relative");
    const innerContainer = termContainer?.querySelector("div");
    if (innerContainer) {
      Object.defineProperty(innerContainer, "clientWidth", { value: 640, configurable: true });
      Object.defineProperty(innerContainer, "clientHeight", { value: 480, configurable: true });
    }

    act(() => {
      capturedResizeCallback!();
    });

    expect(resizeTerminal).toHaveBeenCalledWith("term-1", expect.any(Number), expect.any(Number));
    vi.unstubAllGlobals();
  });
});
