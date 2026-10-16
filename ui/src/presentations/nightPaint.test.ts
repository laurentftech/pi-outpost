import { describe, expect, it } from "vitest";
import { nightColour, screenColour, screenPaint } from "./nightPaint";

/** OKLab lightness is what the mapping works in; relative luminance is close enough to order colours here. */
function luminance(hex: string): number {
  const channel = (at: number) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Hue in degrees, from the sRGB channels: enough to tell blue from orange. */
function hue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return Number.NaN;
  const raw = max === r ? (g - b) / (max - min) : max === g ? 2 + (b - r) / (max - min) : 4 + (r - g) / (max - min);
  return (raw * 60 + 360) % 360;
}

describe("night colours for a figure", () => {
  it("turns the white ground into the dark ground a Mermaid diagram sits on", () => {
    const ground = nightColour("#ffffff");
    // zinc-900, #18181b, give or take its faint blue.
    expect(contrast(ground, "#18181b")).toBeLessThan(1.05);
  });

  it("turns dark ink into light ink that reads on the night ground", () => {
    const ground = nightColour("#ffffff");
    expect(luminance(nightColour("#27272a"))).toBeGreaterThan(luminance(ground));
    expect(contrast(nightColour("#27272a"), ground)).toBeGreaterThanOrEqual(7);
  });

  it("keeps a pale fill dark and a strong stroke strong, in that order", () => {
    const ground = nightColour("#ffffff");
    const paleFill = nightColour("#eff6ff");
    const stroke = nightColour("#2563eb");
    expect(contrast(paleFill, ground)).toBeLessThan(1.6);
    expect(contrast(stroke, ground)).toBeGreaterThan(3);
    expect(contrast(stroke, ground)).toBeGreaterThan(contrast(paleFill, ground));
  });

  it("keeps a colour's hue, so a kind still matches its swatch", () => {
    for (const colour of ["#2563eb", "#ea580c", "#059669", "#7c3aed", "#dc2626"]) {
      const shift = Math.abs(hue(colour) - hue(nightColour(colour)));
      expect(Math.min(shift, 360 - shift)).toBeLessThan(15);
    }
  });

  it("reads a three-digit colour as its six-digit form", () => {
    expect(nightColour("#fff")).toBe(nightColour("#ffffff"));
  });

  it("leaves what is not a colour alone", () => {
    expect(nightColour("none")).toBe("none");
    expect(screenColour("transparent")).toBeUndefined();
    expect(screenColour(undefined)).toBeUndefined();
    expect(screenPaint({ fill: "none" })).toBeUndefined();
  });

  it("gives the screen both colours, day first, for the page's theme to choose", () => {
    expect(screenPaint({ fill: "#ffffff", stroke: "#2563eb" })).toEqual({
      fill: `light-dark(#ffffff, ${nightColour("#ffffff")})`,
      stroke: `light-dark(#2563eb, ${nightColour("#2563eb")})`,
    });
  });
});
