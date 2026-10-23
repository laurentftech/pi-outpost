/**
 * Terminal styling, as it actually arrives from an agent's extensions.
 *
 * The samples here are real: little-coder's `/extensions` widget renders itself
 * with truecolor and bold before pi forwards it, and pi-outpost showed the escape
 * bytes to the user because a monospace block prints what it is given.
 */
import { describe, expect, it } from "vitest";
import { parseAnsi, stripAnsi } from "./ansi";

const ESC = String.fromCharCode(27);
/** Write sequences readably: sgr("1") is bold, sgr("39") is default foreground. */
const sgr = (params: string) => `${ESC}[${params}m`;

describe("parseAnsi", () => {
  it("returns plain text as a single unstyled segment", () => {
    expect(parseAnsi("nothing to see")).toEqual([{ text: "nothing to see" }]);
  });

  it("reads a truecolor foreground", () => {
    const segments = parseAnsi(`${sgr("38;2;225;90;31")}◆${sgr("39")} rest`);
    expect(segments[0]).toEqual({ text: "◆", color: "rgb(225 90 31)" });
    expect(segments[1]).toEqual({ text: " rest" });
  });

  it("reads bold and closes it on 22", () => {
    const segments = parseAnsi(`${sgr("1")}extensions${sgr("22")}  tail`);
    expect(segments[0]).toEqual({ text: "extensions", bold: true });
    expect(segments[1]).toEqual({ text: "  tail" });
  });

  it("maps bright black, which is how extensions mark secondary text", () => {
    const [segment] = parseAnsi(`${sgr("90")}(/extensions to close)`);
    expect(segment.color).toBe("#a1a1aa");
  });

  it("clears every attribute on a reset", () => {
    const segments = parseAnsi(`${sgr("1")}${sgr("31")}loud${sgr("0")}quiet`);
    expect(segments[0]).toEqual({ text: "loud", bold: true, color: "#dc2626" });
    expect(segments[1]).toEqual({ text: "quiet" });
  });

  it("treats a bare CSI m as a reset, the way a terminal does", () => {
    const segments = parseAnsi(`${sgr("1")}bold${sgr("")}plain`);
    expect(segments[1]).toEqual({ text: "plain" });
  });

  it("consumes a 256-colour sequence rather than leaving its digits as text", () => {
    // A headless SDK can emit indexed colours even without a terminal.
    const segments = parseAnsi(`${sgr("38;5;208")}orange`);
    expect(segments).toEqual([{ text: "orange", color: "rgb(255 135 0)" }]);
  });

  it("maps indexed basic, cube endpoints and greys, and resets the colour", () => {
    for (const [index, color] of [[1, "#dc2626"], [9, "#ef4444"], [16, "rgb(0 0 0)"], [231, "rgb(255 255 255)"], [232, "rgb(8 8 8)"], [255, "rgb(238 238 238)"]] as const) {
      expect(parseAnsi(`${sgr(`38;5;${index}`)}x${sgr("39")}y`)).toEqual([{ text: "x", color }, { text: "y" }]);
    }
    expect(parseAnsi(`${sgr("38;5;256")}x`)).toEqual([{ text: "x" }]);
  });

  it("drops cursor control, which has no meaning in a div", () => {
    const segments = parseAnsi(`before${ESC}[2Kafter`);
    expect(segments.map((s) => s.text).join("")).toBe("beforeafter");
  });

  it("carries style across a line's worth of mixed runs", () => {
    const line = `  ${sgr("38;2;225;90;31")}bundled${sgr("39")}   34 ${sgr("90")}loaded${sgr("39")}`;
    expect(parseAnsi(line).map((s) => s.text).join("")).toBe("  bundled   34 loaded");
    expect(parseAnsi(line).find((s) => s.text === "bundled")?.color).toBe("rgb(225 90 31)");
    expect(parseAnsi(line).find((s) => s.text === "loaded")?.color).toBe("#a1a1aa");
  });

  it("is reusable — the shared pattern must not carry lastIndex between calls", () => {
    const line = `${sgr("1")}first${sgr("22")}`;
    expect(parseAnsi(line)).toEqual(parseAnsi(line));
  });
});

describe("stripAnsi", () => {
  it("leaves only what a person would read aloud", () => {
    const line = `${sgr("38;2;225;90;31")}◆${sgr("39")} ${sgr("1")}extensions${sgr("22")}  ${sgr("90")}(/extensions to close)${sgr("39")}`;
    expect(stripAnsi(line)).toBe("◆ extensions  (/extensions to close)");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("lint: 3 problems")).toBe("lint: 3 problems");
  });
});

