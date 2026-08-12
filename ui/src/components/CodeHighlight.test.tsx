/**
 * Which language the highlighter is asked for, and what shows while it loads.
 *
 * highlight.js is mocked at its module boundary: the interesting logic is the
 * mapping from a path to a language, and the decision to fall back to
 * auto-detection rather than highlight a file as something it is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CodeHighlight } from "./CodeHighlight";

const highlight = vi.hoisted(() => vi.fn());
const highlightAuto = vi.hoisted(() => vi.fn());
const getLanguage = vi.hoisted(() => vi.fn());
const registerLanguage = vi.hoisted(() => vi.fn());

vi.mock("highlight.js/lib/core", () => ({
  default: { highlight, highlightAuto, getLanguage, registerLanguage },
}));

/** The language the component asked for, or "auto" when it fell back to detection. */
async function languageUsedFor(path: string, code = "const a = 1;") {
  render(<CodeHighlight code={code} path={path} />);
  await waitFor(() => {
    expect(highlight.mock.calls.length + highlightAuto.mock.calls.length).toBeGreaterThan(0);
  });
  if (highlight.mock.calls.length > 0) return highlight.mock.calls[0][1].language;
  return "auto";
}

describe("CodeHighlight", () => {
  beforeEach(() => {
    highlight.mockReset().mockReturnValue({ value: "<span>highlighted</span>" });
    highlightAuto.mockReset().mockReturnValue({ value: "<span>detected</span>" });
    // Every curated language is registered; anything outside the map is not
    getLanguage.mockReset().mockImplementation((name: string) => (name === "unregistered" ? undefined : {}));
    registerLanguage.mockReset();
  });

  it("shows the code as plain text until the highlighter has loaded", () => {
    render(<CodeHighlight code="const a = 1;" path="src/main.ts" />);
    expect(screen.getByText("const a = 1;")).toBeInTheDocument();
  });

  it("replaces it with the highlighted markup once it has", async () => {
    render(<CodeHighlight code="const a = 1;" path="src/main.ts" />);
    await waitFor(() => expect(screen.getByText("highlighted")).toBeInTheDocument());
  });

  describe("choosing a language from the path", () => {
    it("maps the TypeScript family", async () => {
      for (const path of ["a.ts", "a.tsx", "a.mts", "a.cts"]) {
        highlight.mockClear();
        expect(await languageUsedFor(path)).toBe("typescript");
      }
    });

    it("maps the JavaScript family", async () => {
      for (const path of ["a.js", "a.jsx", "a.mjs", "a.cjs"]) {
        highlight.mockClear();
        expect(await languageUsedFor(path)).toBe("javascript");
      }
    });

    it("maps markup and styles", async () => {
      const cases: Array<[string, string]> = [
        ["page.html", "xml"],
        ["page.htm", "xml"],
        ["icon.svg", "xml"],
        ["app.css", "css"],
        ["app.scss", "scss"],
      ];
      for (const [path, language] of cases) {
        highlight.mockClear();
        expect(await languageUsedFor(path)).toBe(language);
      }
    });

    it("maps the shells to bash", async () => {
      for (const path of ["run.sh", "run.bash", "run.zsh"]) {
        highlight.mockClear();
        expect(await languageUsedFor(path)).toBe("bash");
      }
    });

    it("maps the C family", async () => {
      const cases: Array<[string, string]> = [
        ["a.c", "c"],
        ["a.h", "c"],
        ["a.cpp", "cpp"],
        ["a.cc", "cpp"],
        ["a.hpp", "cpp"],
        ["a.cs", "csharp"],
      ];
      for (const [path, language] of cases) {
        highlight.mockClear();
        expect(await languageUsedFor(path)).toBe(language);
      }
    });

    it("maps TOML onto the ini highlighter, which is close enough to be useful", async () => {
      expect(await languageUsedFor("config.toml")).toBe("ini");
    });

    it("recognises a Dockerfile, which has no extension at all", async () => {
      expect(await languageUsedFor("Dockerfile")).toBe("dockerfile");
    });

    it("recognises it in a subdirectory too", async () => {
      expect(await languageUsedFor("docker/Dockerfile")).toBe("dockerfile");
    });

    it("reads the extension case-insensitively", async () => {
      expect(await languageUsedFor("README.MD")).toBe("markdown");
    });

    it("uses the file's own name, not a directory that looks like an extension", async () => {
      expect(await languageUsedFor("src.ts/notes.py")).toBe("python");
    });
  });

  describe("falling back to detection", () => {
    it("detects rather than guessing for an unknown extension", async () => {
      expect(await languageUsedFor("notes.xyz")).toBe("auto");
    });

    it("detects for a file with no extension", async () => {
      expect(await languageUsedFor("LICENSE")).toBe("auto");
    });

    it("detects for a dotfile, which is a name and not an extension", async () => {
      expect(await languageUsedFor(".gitignore")).toBe("auto");
    });

    it("detects when the mapped language turned out not to be registered", async () => {
      // The map names a language the curated bundle does not carry: detect rather
      // than call highlight() with something hljs will reject
      getLanguage.mockReturnValue(undefined);
      expect(await languageUsedFor("a.ts")).toBe("auto");
    });
  });

  it("re-highlights when the file changes", async () => {
    const { rerender } = render(<CodeHighlight code="a" path="a.ts" />);
    await waitFor(() => expect(highlight).toHaveBeenCalledTimes(1));
    rerender(<CodeHighlight code="b" path="b.py" />);
    await waitFor(() => expect(highlight).toHaveBeenCalledTimes(2));
    expect(highlight.mock.calls[1][1].language).toBe("python");
  });
});
