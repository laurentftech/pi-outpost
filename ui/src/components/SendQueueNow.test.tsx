import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SendQueueNow } from "./SendQueueNow";

function setup(props: Partial<React.ComponentProps<typeof SendQueueNow>> = {}) {
  const onSend = vi.fn();
  const view = render(<SendQueueNow isStreaming={false} count={2} onSend={onSend} {...props} />);
  const rerenderWith = (next: Partial<React.ComponentProps<typeof SendQueueNow>>) =>
    view.rerender(<SendQueueNow isStreaming={false} count={2} onSend={onSend} {...props} {...next} />);
  return { onSend, rerenderWith };
}

describe("SendQueueNow", () => {
  // openlore: scenario=TheQueueIsSentAfterAStop spec=queued-prompts
  it("sends at once when no turn runs: there is nothing to interrupt", () => {
    const { onSend } = setup();
    fireEvent.click(screen.getByRole("button", { name: "send all 2 now" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("names a single prompt as such", () => {
    setup({ count: 1 });
    expect(screen.getByRole("button", { name: "send it now" })).toBeInTheDocument();
  });

  // openlore: scenario=SendingNowAsksFirstWhileATurnRuns spec=queued-prompts
  it("asks first while a turn runs, saying what is lost and what is kept, and cancel changes nothing", () => {
    const { onSend } = setup({ isStreaming: true });
    fireEvent.click(screen.getByRole("button", { name: "send all 2 now" }));
    expect(onSend).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: /confirm/i });
    expect(confirm).toHaveTextContent(/stops the current step/);
    expect(confirm).toHaveTextContent(/reply being written is dropped/);
    expect(confirm).toHaveTextContent(/Work already done is kept/);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "send all 2 now" })).toBeInTheDocument();
  });

  // openlore: scenario=SendingNowStopsTheStepInProgress spec=queued-prompts
  it("sends once confirmed", () => {
    const { onSend } = setup({ isStreaming: true });
    fireEvent.click(screen.getByRole("button", { name: "send all 2 now" }));
    fireEvent.click(screen.getByRole("button", { name: "stop and send" }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("group", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("drops a pending confirmation when the turn ends on its own", () => {
    const { onSend, rerenderWith } = setup({ isStreaming: true });
    fireEvent.click(screen.getByRole("button", { name: "send all 2 now" }));
    rerenderWith({ isStreaming: false });
    expect(screen.queryByRole("group", { name: /confirm/i })).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
  });
});
