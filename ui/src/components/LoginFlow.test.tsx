import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LoginFlow } from "./LoginFlow";
import type { LoginFlowState } from "../useAgent";

const state = (overrides: Partial<LoginFlowState> = {}): LoginFlowState => ({ flowId: "f1", provider: "codex", method: "oauth", events: [], prompt: null, done: null, ...overrides });

describe("LoginFlow", () => {
  it("renders authorization link and device code and allows cancellation", () => {
    const cancel = vi.fn();
    render(<LoginFlow login={state({ events: [
      { type: "auth_url", url: "https://example.test/login" },
      { type: "device_code", userCode: "ABCD-EFGH", verificationUri: "https://example.test/device" },
    ] })} providerName="Codex" onAnswer={vi.fn()} onCancel={cancel} onDismiss={vi.fn()} />);
    expect(screen.getByRole("link", { name: "https://example.test/login" })).toHaveAttribute("href", "https://example.test/login");
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("sends a manual code and renders a secret prompt as a password field", () => {
    const answer = vi.fn();
    const { rerender } = render(<LoginFlow login={state({ prompt: { promptId: "p1", prompt: { type: "manual_code", message: "Paste the code" } } })} providerName="Codex" onAnswer={answer} onCancel={vi.fn()} onDismiss={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "code-123" } });
    expect(screen.getByRole("textbox")).toHaveAttribute("name", "provider-auth-response");
    expect(screen.getByRole("textbox")).toHaveAttribute("spellcheck", "false");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(answer).toHaveBeenCalledWith("code-123");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "code-456" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(answer).toHaveBeenCalledWith("code-456");
    rerender(<LoginFlow login={state({ prompt: { promptId: "p2", prompt: { type: "secret", message: "Password" } } })} providerName="Codex" onAnswer={answer} onCancel={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByTestId("login-flow").querySelector("[aria-live='polite']")).toBeInTheDocument();
  });

  it("explains how to finish a remote OpenAI loopback callback", () => {
    render(<LoginFlow login={state({ prompt: { promptId: "p1", prompt: {
      type: "manual_code",
      message: "Paste the authorization code or redirect URL",
      placeholder: "http://localhost:1455/auth/callback",
    } } })} providerName="OpenAI" onAnswer={vi.fn()} onCancel={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/your browser may say it cannot connect to localhost/i)).toBeInTheDocument();
    expect(screen.getByText(/copy the full address from that browser page/i)).toBeInTheDocument();
  });
});
