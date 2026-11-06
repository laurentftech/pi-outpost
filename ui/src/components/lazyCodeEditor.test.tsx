import React, { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("LazyCodeEditor", () => {
  it("loads the editor on demand and renders after the fallback", async () => {
    vi.resetModules();
    const { LazyCodeEditor, preloadCodeEditor } = await import("./lazyCodeEditor");
    render(<Suspense fallback={<p>Loading editor</p>}><LazyCodeEditor value="const answer = 42;" path="answer.ts" readOnly /></Suspense>);
    expect(screen.getByText("Loading editor")).toBeInTheDocument();
    const preloaded = await preloadCodeEditor();
    expect(await preloadCodeEditor()).toBe(preloaded);
    expect(await screen.findByTestId("file-source")).toBeInTheDocument();
    expect(screen.queryByText("Loading editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("file-source")).toHaveTextContent("const answer = 42;");
  });

  it("forgets a failed chunk load so a later preload retries", async () => {
    vi.resetModules();
    vi.doMock("./CodeEditor", () => {
      throw new Error("editor chunk unavailable");
    });
    const { preloadCodeEditor } = await import("./lazyCodeEditor");
    await expect(preloadCodeEditor()).rejects.toThrow();
    vi.doUnmock("./CodeEditor");
    const retried = await preloadCodeEditor();
    expect(retried.CodeEditor).toBeDefined();
  });
});
