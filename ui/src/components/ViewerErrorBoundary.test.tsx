import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ViewerErrorBoundary } from "./ViewerErrorBoundary";

function Boom(): never {
  throw new Error("render exploded");
}

describe("ViewerErrorBoundary", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the caught error itself; the test asserts behaviour, not noise.
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("shows its children when nothing goes wrong", () => {
    render(
      <ViewerErrorBoundary>
        <p>the document</p>
      </ViewerErrorBoundary>,
    );

    expect(screen.getByText("the document")).toBeInTheDocument();
  });

  it("keeps a crash inside the pane instead of unmounting the app", () => {
    render(
      <div>
        <span>the rest of the app</span>
        <ViewerErrorBoundary label="This PDF">
          <Boom />
        </ViewerErrorBoundary>
      </div>,
    );

    expect(screen.getByText(/This PDF could not be displayed/)).toBeInTheDocument();
    expect(screen.getByText("the rest of the app")).toBeInTheDocument();
  });

  it("names the file generically when no label is given", () => {
    render(
      <ViewerErrorBoundary>
        <Boom />
      </ViewerErrorBoundary>,
    );

    expect(screen.getByText(/This file could not be displayed/)).toBeInTheDocument();
  });
});
