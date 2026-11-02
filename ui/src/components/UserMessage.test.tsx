import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ChatItem } from "@pi-outpost/shared";
import { UserMessage } from "./UserMessage";

type UserItem = Extract<ChatItem, { kind: "user" }>;

function item(overrides: Partial<UserItem> = {}): UserItem {
  return { kind: "user", text: "how do I start?", entryId: "e1", ...overrides };
}

type Props = React.ComponentProps<typeof UserMessage>;

function setup(overrides: Partial<Props> = {}) {
  const onEdit = vi.fn();
  const props: Props = { item: item(), canEdit: true, onEdit, ...overrides };
  const view = render(<UserMessage {...props} />);
  const rerenderWith = (next: Partial<Props>) => view.rerender(<UserMessage {...props} {...next} />);
  return { onEdit, ...view, rerenderWith };
}

const editButton = () => screen.getByRole("button", { name: "Edit this prompt" });
const draftBox = () => screen.getByRole("textbox", { name: "Edit prompt" });
const startEditing = () => fireEvent.click(editButton());

describe("UserMessage", () => {
  it("shows the prompt as sent", () => {
    setup();
    expect(screen.getByText("how do I start?")).toBeInTheDocument();
  });

  it("keeps the text's own line breaks", () => {
    setup({ item: item({ text: "line one\nline two" }) });
    expect(screen.getByText(/line one/).className).toMatch(/whitespace-pre-wrap/);
  });

  it("shows attached images", () => {
    setup({ item: item({ images: [{ data: "AAAA", mimeType: "image/png" }] }) });
    expect(screen.getByRole("presentation")).toHaveAttribute("src", "data:image/png;base64,AAAA");
  });

  describe("when editing is possible", () => {
    it("offers the edit affordance", () => {
      setup();
      expect(editButton()).toBeInTheDocument();
    });

    it("hides it while the agent is running", () => {
      setup({ canEdit: false });
      expect(screen.queryByRole("button", { name: "Edit this prompt" })).not.toBeInTheDocument();
    });

    it("hides it for a turn with no persisted entry to rewind to", () => {
      setup({ item: item({ entryId: undefined }) });
      expect(screen.queryByRole("button", { name: "Edit this prompt" })).not.toBeInTheDocument();
    });
  });

  describe("editing", () => {
    it("opens on the current text", () => {
      setup();
      startEditing();
      expect(draftBox()).toHaveValue("how do I start?");
    });

    it("re-asks from this turn on Enter", () => {
      const { onEdit } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "how do I finish?" } });
      fireEvent.keyDown(draftBox(), { key: "Enter" });
      expect(onEdit).toHaveBeenCalledWith("e1", "how do I finish?", undefined);
    });

    it("carries the attached images into the new ask", () => {
      const images = [{ data: "AAAA", mimeType: "image/png" }];
      const { onEdit } = setup({ item: item({ images }) });
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "and this one?" } });
      fireEvent.click(screen.getByRole("button", { name: "send" }));
      expect(onEdit).toHaveBeenCalledWith("e1", "and this one?", images);
    });

    it("keeps Shift+Enter for a newline", () => {
      const { onEdit } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "changed" } });
      fireEvent.keyDown(draftBox(), { key: "Enter", shiftKey: true });
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("does not submit mid-composition, so an IME candidate is not an edit", () => {
      const { onEdit } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "こんにち" } });
      fireEvent.keyDown(draftBox(), { key: "Enter", isComposing: true });
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("closes without asking again when the text came back unchanged", () => {
      const { onEdit } = setup();
      startEditing();
      fireEvent.keyDown(draftBox(), { key: "Enter" });
      expect(onEdit).not.toHaveBeenCalled();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("refuses to send an empty draft", () => {
      const { onEdit } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "   " } });
      expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
      fireEvent.keyDown(draftBox(), { key: "Enter" });
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("abandons the draft on Escape", () => {
      const { onEdit } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "changed" } });
      fireEvent.keyDown(draftBox(), { key: "Escape" });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("abandons it on cancel too", () => {
      setup();
      startEditing();
      fireEvent.click(screen.getByRole("button", { name: "cancel" }));
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("holds the draft open rather than swallowing it when the agent starts running", () => {
      // Losing typed text to a state change the user did not cause is worse than
      // making them wait: the draft stays, the send button goes quiet
      const { rerenderWith, onEdit } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "changed" } });
      rerenderWith({ canEdit: false });
      expect(draftBox()).toHaveValue("changed");
      expect(screen.getByRole("button", { name: "send" })).toBeDisabled();
      fireEvent.keyDown(draftBox(), { key: "Enter" });
      expect(onEdit).not.toHaveBeenCalled();
    });

    it("says why the send is unavailable", () => {
      const { rerenderWith } = setup();
      startEditing();
      expect(screen.getByText(/asks again from here/)).toBeInTheDocument();
      rerenderWith({ canEdit: false });
      expect(screen.getByText(/the agent is running/)).toBeInTheDocument();
    });

    it("drops the draft when the turn underneath it changes", () => {
      // Navigating the tree replaces the items in place: submitting the old draft
      // would edit whatever message now occupies this slot
      const { rerenderWith } = setup();
      startEditing();
      fireEvent.change(draftBox(), { target: { value: "changed" } });
      rerenderWith({ item: item({ entryId: "e2", text: "a different turn" }) });
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByText("a different turn")).toBeInTheDocument();
    });
  });

  describe("a queued prompt", () => {
    const queuedSetup = (overrides: Partial<Props> = {}) => {
      const onRemove = vi.fn();
      const view = setup({ item: item({ entryId: "q3", text: "fix the tpyo" }), queued: { onRemove }, ...overrides });
      return { onRemove, ...view };
    };
    const editQueued = () => screen.getByRole("button", { name: "Edit this queued message" });
    const removeQueued = () => screen.getByRole("button", { name: "Remove this queued message" });

    // openlore: scenario=AQueuedPromptWaitsAsAPendingBubble spec=queued-prompts
    it("says it is waiting, and offers the pencil and the ✕", () => {
      queuedSetup();
      // Said to screen readers and on hover; seen as a paler bubble with no frame or heading.
      expect(screen.getByText("queued — not read yet")).toHaveClass("sr-only");
      expect(screen.getByText("fix the tpyo").closest("[title]")).toHaveAttribute("title", "queued — the agent has not read it yet");
      expect(screen.getByText("fix the tpyo").closest("[title]")!.className).not.toMatch(/border-dashed/);
      expect(editQueued()).toHaveTextContent("✎");
      expect(removeQueued()).toHaveTextContent("✕");
      expect(screen.queryByRole("button", { name: "Edit this prompt" })).not.toBeInTheDocument();
    });

    // openlore: scenario=EditAQueuedPrompt spec=queued-prompts
    it("edits in place and saves under its queue id, while the agent runs", () => {
      const { onEdit } = queuedSetup();
      fireEvent.click(editQueued());
      expect(draftBox()).toHaveValue("fix the tpyo");
      expect(screen.getByText(/replaces the queued message/)).toBeInTheDocument();
      fireEvent.change(draftBox(), { target: { value: "fix the typo" } });
      fireEvent.click(screen.getByRole("button", { name: "save" }));
      expect(onEdit).toHaveBeenCalledWith("q3", "fix the typo", undefined);
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    // openlore: scenario=RemoveAQueuedPrompt spec=queued-prompts
    it("removes itself with the ✕, once however fast it is clicked", () => {
      const { onRemove, onEdit } = queuedSetup();
      const button = removeQueued();
      fireEvent.click(button);
      fireEvent.click(button);
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "Remove this queued message" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit this queued message" })).not.toBeInTheDocument();
    });

    // openlore: scenario=AQueueThatCannotBeRewrittenIsReadOnly spec=queued-prompts
    it("offers neither action when the queue cannot be rewritten", () => {
      queuedSetup({ canEdit: false });
      expect(screen.getByText("fix the tpyo")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit this queued message" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Remove this queued message" })).not.toBeInTheDocument();
    });

    it("keeps an open draft when the connection drops, and saves nothing", () => {
      const { onEdit, rerenderWith } = queuedSetup();
      fireEvent.click(editQueued());
      fireEvent.change(draftBox(), { target: { value: "fix the typo" } });
      rerenderWith({ canEdit: false });
      expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
      expect(draftBox()).toHaveValue("fix the typo");
      expect(onEdit).not.toHaveBeenCalled();
    });
  });
});
