/**
 * Rewriting a direction without rewriting the diagram.
 *
 * Every case here is a source a model plausibly writes. What is being checked is that
 * exactly one token moves and nothing else does — a rewrite that reflows or reorders
 * would mean the reader is shown a diagram the agent did not describe, which is worse
 * than leaving it too wide to read.
 */
import { describe, it, expect } from "vitest";
import { orientableMermaid, orientationOfDirection, turnedDirection } from "./mermaidDirection";

describe("which way a source says it runs", () => {
  it("reads the direction off a flowchart header", () => {
    expect(orientableMermaid("flowchart LR\n  a --> b")?.direction).toBe("LR");
    expect(orientableMermaid("flowchart TB\n  a --> b")?.direction).toBe("TB");
    expect(orientableMermaid("flowchart BT\n  a --> b")?.direction).toBe("BT");
    expect(orientableMermaid("flowchart RL\n  a --> b")?.direction).toBe("RL");
  });

  it("reads TD as the top-to-bottom it is", () => {
    // Mermaid's own synonym, and about half the sources use it.
    expect(orientableMermaid("flowchart TD\n  a --> b")?.direction).toBe("TB");
  });

  it("reads the older graph keyword too", () => {
    expect(orientableMermaid("graph LR\n  a --> b")?.direction).toBe("LR");
  });

  it("takes a header with no direction as the top-to-bottom mermaid draws", () => {
    // Not "no direction": a bare flowchart is drawn downwards, so that is what
    // turning it turns away from.
    expect(orientableMermaid("flowchart\n  a --> b")?.direction).toBe("TB");
  });
});

describe("turning a flowchart moves one token and nothing else", () => {
  it("turns across into down", () => {
    const turned = orientableMermaid("flowchart LR\n  a[Start] --> b[End]")!.turned;
    expect(turned).toBe("flowchart TB\n  a[Start] --> b[End]");
  });

  it("turns down into across", () => {
    expect(orientableMermaid("flowchart TD\n  a --> b")!.turned).toBe("flowchart LR\n  a --> b");
  });

  it("keeps which end the flow starts from", () => {
    // RL becomes BT rather than TB: turning a diagram should not also reverse the
    // reader's sense of which way it flows.
    expect(orientableMermaid("flowchart RL\n  a --> b")!.turned).toBe("flowchart BT\n  a --> b");
    expect(orientableMermaid("flowchart BT\n  a --> b")!.turned).toBe("flowchart RL\n  a --> b");
  });

  it("states a direction on a header that had none", () => {
    expect(orientableMermaid("flowchart\n  a --> b")!.turned).toBe("flowchart LR\n  a --> b");
  });

  it("leaves a direction inside a subgraph alone", () => {
    // That one is local to its subgraph. Rewriting it would turn a group inside a
    // diagram that stayed as it was.
    const code = ["flowchart LR", "  subgraph inner", "    direction TB", "    a --> b", "  end"].join("\n");
    const turned = orientableMermaid(code)!.turned;
    expect(turned).toContain("    direction TB");
    expect(turned.split("\n")[0]).toBe("flowchart TB");
  });

  it("keeps whatever follows the header on its line", () => {
    const turned = orientableMermaid("flowchart LR;\n  a --> b")!.turned;
    expect(turned).toBe("flowchart TB;\n  a --> b");
  });

  it("finds the header past frontmatter, directives and comments", () => {
    const code = [
      "---",
      "title: A diagram",
      "---",
      "%%{init: {'theme':'dark'}}%%",
      "%% what follows is the graph",
      "",
      "flowchart LR",
      "  a --> b",
    ].join("\n");
    const read = orientableMermaid(code)!;
    expect(read.direction).toBe("LR");
    expect(read.turned.split("\n")[6]).toBe("flowchart TB");
    // Everything before it is untouched, including the directive that used to be
    // mistaken for the header.
    expect(read.turned.split("\n").slice(0, 6)).toEqual(code.split("\n").slice(0, 6));
  });

  it("turns back to exactly what it started as", () => {
    const code = "flowchart LR\n  a[Start] --> b[End]\n";
    const once = orientableMermaid(code)!.turned;
    expect(orientableMermaid(once)!.turned).toBe(code);
  });
});

describe("a state diagram states its direction in a statement, not a header", () => {
  it("reads and turns a top-level direction", () => {
    const code = ["stateDiagram-v2", "    direction LR", "    A --> B"].join("\n");
    const read = orientableMermaid(code)!;
    expect(read.direction).toBe("LR");
    expect(read.turned).toBe(["stateDiagram-v2", "    direction TB", "    A --> B"].join("\n"));
  });

  it("states one when the source states none", () => {
    const read = orientableMermaid("stateDiagram-v2\n    A --> B")!;
    expect(read.direction).toBe("TB");
    expect(read.turned).toBe("stateDiagram-v2\n    direction LR\n    A --> B");
  });

  it("leaves a direction inside a composite state alone", () => {
    const code = [
      "stateDiagram-v2",
      "    state Outer {",
      "        direction LR",
      "        A --> B",
      "    }",
      "    Outer --> Done",
    ].join("\n");
    const read = orientableMermaid(code)!;
    // The nested one is that composite state's own; this diagram states nothing, so
    // it is top to bottom and turning it adds a statement of its own.
    expect(read.direction).toBe("TB");
    expect(read.turned).toContain("        direction LR");
    expect(read.turned.split("\n")[1]).toBe("    direction LR");
  });

  it("handles the older keyword", () => {
    expect(orientableMermaid("stateDiagram\n    A --> B")?.direction).toBe("TB");
  });
});

describe("a notation with no direction to choose is left alone", () => {
  for (const [notation, code] of [
    ["sequenceDiagram", "sequenceDiagram\n  A->>B: hello"],
    ["pie", "pie title Pets\n  \"Dogs\" : 40"],
    ["gantt", "gantt\n  title A schedule"],
    ["classDiagram", "classDiagram\n  Animal <|-- Duck"],
    ["erDiagram", "erDiagram\n  CUSTOMER ||--o{ ORDER : places"],
    ["journey", "journey\n  title My day"],
    ["gitGraph", "gitGraph\n  commit"],
  ] as const) {
    it(`offers nothing for ${notation}`, () => {
      expect(orientableMermaid(code)).toBeUndefined();
    });
  }

  it("offers nothing for a notation it does not recognise", () => {
    // Mermaid grows notations faster than this file does. Not recognising one costs
    // the reader today's behaviour; guessing at one costs them a diagram that renders.
    expect(orientableMermaid("quadrantChart\n  x-axis Low --> High")).toBeUndefined();
  });

  it("offers nothing for an empty source, or one that is all comments", () => {
    expect(orientableMermaid("")).toBeUndefined();
    expect(orientableMermaid("\n\n%% nothing here\n")).toBeUndefined();
  });

  it("offers nothing when frontmatter is never closed", () => {
    expect(orientableMermaid("---\ntitle: unfinished\nflowchart LR\n  a --> b")).toBeUndefined();
  });
});

describe("a direction names an orientation", () => {
  it("reads across and down the way the rest of the application does", () => {
    expect(orientationOfDirection("LR")).toBe("landscape");
    expect(orientationOfDirection("RL")).toBe("landscape");
    expect(orientationOfDirection("TB")).toBe("portrait");
    expect(orientationOfDirection("BT")).toBe("portrait");
  });

  it("turning a direction always changes the orientation", () => {
    for (const direction of ["LR", "RL", "TB", "BT"] as const) {
      expect(orientationOfDirection(turnedDirection(direction))).not.toBe(orientationOfDirection(direction));
    }
  });
});
