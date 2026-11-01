import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SandboxGrantRequest } from "@pi-outpost/shared";
import { SandboxGrantDialog } from "./SandboxGrantDialog";

const request = (overrides: Partial<SandboxGrantRequest> = {}): SandboxGrantRequest => ({
  id: "g1",
  kind: "command",
  command: "curl -sI https://example.com/ && cp out.txt ../beside/",
  grant: { hosts: ["example.com"], directories: [{ path: "/work/beside", access: "write" }, { path: "/work/notes", access: "read" }] },
  reason: "Check the release page, then copy the build output.",
  overridesReadOnly: false,
  expiresAt: Date.now() + 5 * 60_000,
  ...overrides,
});

describe("the grant dialog", () => {
  it("shows the command verbatim, every target with its access, and the reason as the agent's words", () => {
    render(<SandboxGrantDialog request={request()} onRespond={() => {}} />);
    expect(screen.getByTestId("sandbox-grant-command").textContent).toBe("curl -sI https://example.com/ && cp out.txt ../beside/");
    const targets = screen.getByTestId("sandbox-grant-targets").textContent;
    expect(targets).toContain("host example.com");
    expect(targets).toContain("read and write /work/beside");
    expect(targets).toContain("read /work/notes");
    expect(screen.getByText("The agent says")).toBeTruthy();
    expect(screen.getByTestId("sandbox-grant-reason").textContent).toBe("Check the release page, then copy the build output.");
    expect(screen.queryByTestId("sandbox-grant-overrides")).toBeNull();
  });

  it("a connection waiting on the answer says so: the running command, the host, and that the agent did not ask", () => {
    const onRespond = vi.fn();
    render(
      <SandboxGrantDialog
        request={request({ kind: "connection", command: "git clone https://github.com/o/r", grant: { hosts: ["github.com"], directories: [] }, reason: "server text" })}
        onRespond={onRespond}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("A running command is connecting to github.com");
    expect(screen.getByText("The running command")).toBeTruthy();
    expect(screen.getByTestId("sandbox-grant-command").textContent).toBe("git clone https://github.com/o/r");
    expect(screen.getByTestId("sandbox-grant-reason").textContent).toMatch(/The agent did not ask for it/);
    expect(screen.queryByText("The agent says")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Allow for this command" }));
    expect(onRespond).toHaveBeenCalledWith("g1", "once");
  });

  it("says when a write grant overrides a sandbox with writing off", () => {
    render(<SandboxGrantDialog request={request({ overridesReadOnly: true })} onRespond={() => {}} />);
    expect(screen.getByTestId("sandbox-grant-overrides").textContent).toMatch(/Writing is off/);
  });

  it.each([
    ["Allow once", "once"],
    ["Allow for this session", "session"],
    ["Refuse", "refuse"],
  ] as const)("%s answers %s, once: a second click sends nothing", (label, decision) => {
    const onRespond = vi.fn();
    render(<SandboxGrantDialog request={request()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    expect(onRespond.mock.calls).toEqual([["g1", decision]]);
    // Answered: it waits for the server to resolve the request, its buttons off.
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("is not the default for the session: nothing is focused, and the backdrop answers nothing", () => {
    const onRespond = vi.fn();
    render(<SandboxGrantDialog request={request()} onRespond={onRespond} />);
    expect(document.activeElement?.tagName).not.toBe("BUTTON");
    fireEvent.click(screen.getByTestId("sandbox-grant-dialog").parentElement!);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("a new request in its place starts unanswered", () => {
    const onRespond = vi.fn();
    const { rerender } = render(<SandboxGrantDialog request={request()} onRespond={onRespond} />);
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    rerender(<SandboxGrantDialog request={request({ id: "g2", command: "ls ../beside" })} onRespond={onRespond} />);
    expect((screen.getByRole("button", { name: "Allow once" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Refuse" }));
    expect(onRespond.mock.calls).toEqual([["g1", "once"], ["g2", "refuse"]]);
  });
});
