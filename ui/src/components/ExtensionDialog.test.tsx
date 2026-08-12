import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExtensionDialog, parseMultiSelect, parseOptionLine, splitTitle } from "./ExtensionDialog";
import type { DialogRequest } from "../useAgent";

describe("ExtensionDialog", () => {
  const mockOnRespond = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("select method", () => {
    it("renders option buttons for select method", () => {
      const request: DialogRequest = {
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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
        type: "extension_ui_request",
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

  describe("title parsing", () => {
    it("keeps a single-line title as the heading", () => {
      expect(splitTitle("Pick one?")).toEqual({ heading: "Pick one?", body: "" });
    });

    it("splits the question from the context the walker folded in", () => {
      expect(splitTitle("Pick one?\n\n--- 1. A preview ---\ncode")).toEqual({
        heading: "Pick one?",
        body: "--- 1. A preview ---\ncode",
      });
    });

    it("parses a numbered option line into label and description", () => {
      expect(parseOptionLine("1. Postgres — Relational, strong constraints")).toEqual({
        index: 1,
        label: "Postgres",
        description: "Relational, strong constraints",
      });
    });

    it("parses a sentinel line that carries no description", () => {
      expect(parseOptionLine("3. Type something.")).toEqual({ index: 3, label: "Type something.", description: "" });
    });

    it("returns null for a line that is not numbered", () => {
      expect(parseOptionLine("Option 1")).toBeNull();
    });
  });

  describe("select method with walker-formatted content", () => {
    const request: DialogRequest = {
      type: "extension_ui_request",
      id: "walker1",
      method: "select",
      title: "Which database?\n\n--- 1. Postgres preview ---\nCREATE TABLE t (id int);",
      options: ["1. Postgres — Relational, strong constraints", "2. SQLite — Zero setup", "3. Type something."],
    };

    it("renders the question as the heading and the rest as a body block", () => {
      const { container } = render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("Which database?")).toBeInTheDocument();
      expect(container.querySelector("pre")?.textContent).toContain("CREATE TABLE t (id int);");
    });

    it("splits each option into label and description", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getByText("Postgres")).toBeInTheDocument();
      expect(screen.getByText("Relational, strong constraints")).toBeInTheDocument();
      expect(screen.getByText("Type something.")).toBeInTheDocument();
    });

    it("answers with the original option string the walker offered", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("SQLite"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "walker1", value: "2. SQLite — Zero setup" });
    });
  });

  describe("multi-select input", () => {
    const request: DialogRequest = {
      type: "extension_ui_request",
      id: "multi1",
      method: "input",
      title: "[Features] Which features?\n\n1. Auth — Login and sessions\n2. Search — Full text\n3. Export — CSV dumps\n\nEnter the numbers of all that apply, comma-separated.",
      placeholder: "1,3",
    };

    it("recognizes the walker's flattened checkbox question", () => {
      expect(parseMultiSelect(request)).toEqual({
        heading: "[Features] Which features?",
        options: [
          { index: 1, label: "Auth", description: "Login and sessions" },
          { index: 2, label: "Search", description: "Full text" },
          { index: 3, label: "Export", description: "CSV dumps" },
        ],
      });
    });

    it("ignores a dialog whose body is not a 1..n option list", () => {
      expect(parseMultiSelect({ type: "extension_ui_request", id: "x", method: "input", title: "Pick numbers", placeholder: "1,3" })).toBeNull();
    });

    it("renders a checkbox per option instead of a bare text field", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      expect(screen.getAllByRole("checkbox")).toHaveLength(3);
      expect(screen.getByText("Auth")).toBeInTheDocument();
      expect(screen.getByText("Login and sessions")).toBeInTheDocument();
    });

    it("submits the checked options as the comma-separated indices the walker parses", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      const boxes = screen.getAllByRole("checkbox");
      fireEvent.click(boxes[2]);
      fireEvent.click(boxes[0]);
      fireEvent.click(screen.getByText("OK"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "multi1", value: "1,3" });
    });

    it("submits an empty string when nothing is checked, which the walker reads as an empty selection", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getByText("OK"));
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "multi1", value: "" });
    });

    it("lets a typed answer win over the checkboxes", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.click(screen.getAllByRole("checkbox")[0]);
      const custom = screen.getByPlaceholderText("…or type your own answer");
      fireEvent.change(custom, { target: { value: "none of these" } });
      fireEvent.keyDown(custom, { key: "Enter" });
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "multi1", value: "none of these" });
    });

    it("cancels the whole questionnaire on Escape", () => {
      render(<ExtensionDialog request={request} onRespond={mockOnRespond} />);
      fireEvent.keyDown(screen.getByPlaceholderText("…or type your own answer"), { key: "Escape" });
      expect(mockOnRespond).toHaveBeenCalledWith({ id: "multi1", cancelled: true });
    });

    it("falls back to a plain text field when the placeholder matches but the body does not", () => {
      const plain: DialogRequest = { type: "extension_ui_request", id: "plain1", method: "input", title: "Enter numbers", placeholder: "1,3" };
      render(<ExtensionDialog request={plain} onRespond={mockOnRespond} />);
      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("1,3")).toBeInTheDocument();
    });
  });
});
