import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TokenGate } from "./TokenGate";

function renderGate(props?: Record<string, unknown>) {
  const mockOnSubmit = vi.fn();
  const result = render(<TokenGate onSubmit={mockOnSubmit} {...(props as any)} />);
  return { ...result, mockOnSubmit };
}

describe("TokenGate", () => {
  it("renders form, input, and submit button", () => {
    renderGate();
    expect(screen.getByLabelText("Access token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  });

  it("displays default title", () => {
    renderGate();
    expect(screen.getByText("π")).toBeInTheDocument();
  });

  it("displays custom title", () => {
    renderGate({ title: "Custom Title" });
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });

  it("submit button is disabled when input is empty", () => {
    renderGate();
    expect(screen.getByRole("button", { name: "Connect" })).toBeDisabled();
  });

  it("submit button is enabled when input has value", () => {
    renderGate();
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: "t" } });
    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
  });

  it("typing in input updates the field", () => {
    renderGate();
    const input = screen.getByLabelText("Access token") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "test-token" } });
    expect(input.value).toBe("test-token");
  });

  it("form submission calls onSubmit with trimmed token value", () => {
    const { mockOnSubmit } = renderGate();
    fireEvent.change(screen.getByLabelText("Access token"), { target: { value: " test-token " } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(mockOnSubmit).toHaveBeenCalledWith("test-token");
  });

  it("input has type password and autocomplete off", () => {
    renderGate();
    const input = screen.getByLabelText("Access token") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.autocomplete).toBe("off");
  });
});
