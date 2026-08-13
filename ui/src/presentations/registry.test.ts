import { describe, it, expect } from "vitest";
import { PRESENTATIONS, selectPresentation } from "./registry";
import type { ToolItem } from "./types";

function tool(partial: Partial<ToolItem>): ToolItem {
  return {
    kind: "tool",
    toolName: "bash",
    running: false,
    isError: false,
    ...partial,
  } as ToolItem;
}

const GIT_DIFF_OUTPUT = [
  "diff --git a/a.ts b/a.ts",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
].join("\n");

describe("selectPresentation", () => {
  it("is total: an unknown tool with no output still gets a presentation", () => {
    expect(selectPresentation(tool({ toolName: "nope" })).id).toBe("raw");
  });

  it("ends with an entry that matches unconditionally", () => {
    const last = PRESENTATIONS[PRESENTATIONS.length - 1];
    expect(last.id).toBe("raw");
    expect(last.match(tool({ toolName: "anything" }))).toBe(true);
  });

  it("gives every entry a distinct id", () => {
    const ids = PRESENTATIONS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lets an extension's own rendering outrank a built-in one", () => {
    const item = tool({
      toolName: "edit",
      args: { edits: [{ oldText: "a", newText: "b" }] },
      outputHtml: "<div>rendered</div>",
    });
    expect(selectPresentation(item).id).toBe("extension-html");
  });

  it("picks the file-edit presentation from args alone", () => {
    const item = tool({ toolName: "edit", args: { edits: [{ oldText: "a", newText: "b" }] } });
    expect(selectPresentation(item).id).toBe("file-edit");
  });

  it("picks the file-write presentation from args alone", () => {
    expect(selectPresentation(tool({ toolName: "write", args: { content: "x" } })).id).toBe("file-write");
  });

  it("picks the git-diff presentation for a git diff command", () => {
    const item = tool({ args: { command: "git diff --stat" }, output: GIT_DIFF_OUTPUT });
    expect(selectPresentation(item).id).toBe("git-diff");
  });

  it("does not claim a command that merely mentions a diff", () => {
    const item = tool({ args: { command: "echo git diff" }, output: GIT_DIFF_OUTPUT });
    expect(selectPresentation(item).id).toBe("raw");
  });

  it("picks the code-search presentation for the grep tool", () => {
    expect(selectPresentation(tool({ toolName: "grep", args: { pattern: "x" } })).id).toBe("code-search");
  });

  it("picks the render envelope over the raw fallback", () => {
    const item = tool({ toolName: "custom", output: JSON.stringify({ __pi_render: { text: "# hi" } }) });
    expect(selectPresentation(item).id).toBe("pi-render");
  });

  it("picks the vendor summary only when no envelope is present", () => {
    const orient = tool({ toolName: "orient", output: JSON.stringify({ title: "Orient", summary: "s" }) });
    expect(selectPresentation(orient).id).toBe("orient-summary");

    const both = tool({
      toolName: "orient",
      output: JSON.stringify({ __pi_render: { text: "envelope" }, title: "Orient", summary: "s" }),
    });
    expect(selectPresentation(both).id).toBe("pi-render");
  });

  describe("malformed input", () => {
    it("declines rather than throws on args of the wrong shape", () => {
      for (const args of [null, "a string", 42, [], { edits: "not an array" }, { content: 7 }]) {
        expect(() => selectPresentation(tool({ toolName: "edit", args } as Partial<ToolItem>))).not.toThrow();
      }
      expect(selectPresentation(tool({ toolName: "edit", args: { edits: [{ oldText: 1 }] } })).id).toBe("raw");
    });

    it("declines rather than throws when reading args throws", () => {
      const args = new Proxy(
        {},
        {
          get() {
            throw new Error("boom");
          },
        },
      );
      const item = tool({ toolName: "edit", args });
      expect(() => selectPresentation(item)).not.toThrow();
      expect(selectPresentation(item).id).toBe("raw");
    });

    it("declines rather than throws on output that is not the JSON it looks like", () => {
      const item = tool({ toolName: "custom", output: '{"__pi_render": {"text": ' });
      expect(() => selectPresentation(item)).not.toThrow();
      expect(selectPresentation(item).id).toBe("raw");
    });
  });

  describe("stability while streaming", () => {
    it("keeps a specialized choice when the output lands", () => {
      const running = tool({ args: { command: "git diff" }, running: true });
      const chosen = selectPresentation(running);
      expect(chosen.id).toBe("git-diff");

      const done = tool({ args: { command: "git diff" }, output: "fatal: not a git repository" });
      expect(selectPresentation(done, chosen.id).id).toBe("git-diff");
    });

    it("widens the raw fallback once output gives something better to show", () => {
      const running = tool({ toolName: "custom", running: true });
      expect(selectPresentation(running).id).toBe("raw");

      const done = tool({ toolName: "custom", output: JSON.stringify({ __pi_render: { text: "hi" } }) });
      expect(selectPresentation(done, "raw").id).toBe("pi-render");
    });

    it("yields to an extension rendering that arrives after the choice was made", () => {
      const done = tool({
        args: { command: "git diff" },
        output: GIT_DIFF_OUTPUT,
        outputHtml: "<div>rendered</div>",
      });
      expect(selectPresentation(done, "git-diff").id).toBe("extension-html");
    });

    it("drops a stale choice that no longer applies", () => {
      const item = tool({ toolName: "bash", args: { command: "ls" }, output: "a\nb" });
      expect(selectPresentation(item, "git-diff").id).toBe("raw");
    });

    it("ignores a previous id that is not in the table", () => {
      const item = tool({ toolName: "grep", args: { pattern: "x" } });
      expect(selectPresentation(item, "removed-long-ago").id).toBe("code-search");
    });
  });
});
