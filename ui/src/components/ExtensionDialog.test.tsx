import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExtensionDialog } from "./ExtensionDialog";
import type { DialogRequest } from "../useAgent";

describe("ExtensionDialog", () => {
  const mockOnRespond = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("select method", () => {
    it("renders option buttons for select method", () => {
      const request: DialogRequest = {
        id: "select1",
        method: "select",
        title: "Choose an option",
        options: ["Option 1", "Option 2", "Option 3"],
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("Choose an option")).toBeInTheDocument();
      expect(screen.getByText("Option 1")).toBeInTheDocument();
      expect(screen.getByText("Option 2")).toBeInTheDocument();
      expect(screen.getByText("Option 3")).toBeInTheDocument();
    });

    it("calls onRespond with selected value when option is clicked", () => {
      const request: DialogRequest = {
        id: "select1",
        method: "select",
        title: "Choose",
        options: ["A", "B"],
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("B"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "select1", value: "B" });
    });

    it("auto-dismisses after timeout for select method", async () => {
      vi.useFakeTimers();
      const request: DialogRequest = {
        id: "select2",
        method: "select",
        title: "Choose",
        options: ["A"],
        timeout: 3000,
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("auto-dismiss in 3s")).toBeInTheDocument();
      // Cycle second-by-second so React state updates flush between each tick
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "select2", cancelled: true });
      vi.useRealTimers();
    });
  });

  describe("confirm method", () => {
    it("renders Yes/No buttons for confirm method", () => {
      const request: DialogRequest = {
        id: "confirm1",
        method: "confirm",
        title: "Confirm action",
        message: "Are you sure?",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("Confirm action")).toBeInTheDocument();
      expect(screen.getByText("Are you sure?")).toBeInTheDocument();
      expect(screen.getByText("No")).toBeInTheDocument();
      expect(screen.getByText("Yes")).toBeInTheDocument();
    });

    it("calls onRespond with confirmed: true when Yes is clicked", () => {
      const request: DialogRequest = {
        id: "confirm1",
        method: "confirm",
        title: "Confirm",
        message: "Proceed?",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("Yes"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "confirm1", confirmed: true });
    });

    it("calls onRespond with confirmed: false when No is clicked", () => {
      const request: DialogRequest = {
        id: "confirm1",
        method: "confirm",
        title: "Confirm",
        message: "Proceed?",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("No"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "confirm1", confirmed: false });
    });
  });

  describe("input method", () => {
    it("renders text input for input method", () => {
      const request: DialogRequest = {
        id: "input1",
        method: "input",
        title: "Enter text",
        placeholder: "Type here",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("Enter text")).toBeInTheDocument();
      const input = screen.getByPlaceholderText("Type here");
      expect(input).toBeInTheDocument();
    });

    it("submits input value when Enter is pressed", () => {
      const request: DialogRequest = {
        id: "input1",
        method: "input",
        title: "Enter",
        placeholder: "text",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const input = screen.getByPlaceholderText("text");
      fireEvent.change(input, { target: { value: "test value" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "input1", value: "test value" });
    });

    it("cancels when Escape is pressed in input", () => {
      const request: DialogRequest = {
        id: "input1",
        method: "input",
        title: "Enter",
        placeholder: "text",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const input = screen.getByPlaceholderText("text");
      fireEvent.keyDown(input, { key: "Escape" });
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "input1", cancelled: true });
    });

    it("cancels when Cancel button is clicked", () => {
      const request: DialogRequest = {
        id: "input1",
        method: "input",
        title: "Enter",
        placeholder: "text",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("Cancel"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "input1", cancelled: true });
    });

    it("submits when OK button is clicked", () => {
      const request: DialogRequest = {
        id: "input1",
        method: "input",
        title: "Enter",
        placeholder: "text",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const input = screen.getByPlaceholderText("text");
      fireEvent.change(input, { target: { value: "submitted" } });
      fireEvent.click(screen.getByText("OK"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "input1", value: "submitted" });
    });
  });

  describe("editor method", () => {
    it("renders textarea for editor method", () => {
      const request: DialogRequest = {
        id: "editor1",
        method: "editor",
        title: "Edit content",
        prefill: "initial text",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("Edit content")).toBeInTheDocument();
      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue("initial text");
    });

    it("cancels when Escape is pressed in editor", () => {
      const request: DialogRequest = {
        id: "editor1",
        method: "editor",
        title: "Edit",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.keyDown(textarea, { key: "Escape" });
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "editor1", cancelled: true });
    });

    it("cancels when Cancel button is clicked in editor", () => {
      const request: DialogRequest = {
        id: "editor1",
        method: "editor",
        title: "Edit",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("Cancel"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "editor1", cancelled: true });
    });

    it("submits when OK button is clicked in editor", () => {
      const request: DialogRequest = {
        id: "editor1",
        method: "editor",
        title: "Edit",
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const textarea = screen.getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "edited content" } });
      fireEvent.click(screen.getByText("OK"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "editor1", value: "edited content" });
    });
  });

  describe("backdrop interaction", () => {
    it("cancels dialog when clicking backdrop overlay", () => {
      const request: DialogRequest = {
        id: "backdrop1",
        method: "select",
        title: "Test",
        options: ["A"],
      };
      const { container } = render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const overlay = container.firstChild;
      expect(overlay).toBeInTheDocument();
      if (overlay) fireEvent.click(overlay);
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "backdrop1", cancelled: true });
    });

    it("does not cancel when clicking inside modal content", () => {
      const request: DialogRequest = {
        id: "inside1",
        method: "select",
        title: "Test",
        options: ["A"],
      };
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("A"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "inside1", value: "A" });
      expect(mockOnRespond).not.toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
    });
  });
});
