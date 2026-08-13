import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Keeps a failing viewer inside its own pane.
 *
 * Without this, an exception thrown while rendering — or in an effect cleanup —
 * unmounts the entire application: the user loses the conversation and sees a
 * blank page, with nothing naming what broke. A viewer is the least trusted part
 * of the UI (it renders whatever bytes a workspace file happens to contain), so
 * it is the one place that must fail locally.
 */
export class ViewerErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[pi-outpost] viewer crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-md text-center text-sm text-zinc-600 dark:text-zinc-400">
          {this.props.label ?? "This file"} could not be displayed. Close and reopen it to try again.
        </p>
      </div>
    );
  }
}
