/**
 * A figure's colours for a dark page.
 *
 * The figure is computed once, in `shared/`, with the colours a file carries: a white
 * ground, dark ink, pale fills. Those stay the figure's attributes, so what leaves —
 * a download, a copy, a document — is the same picture whatever the reader's theme.
 * On screen each colour is also given as `light-dark(day, night)`, which the page's
 * `color-scheme` resolves: a dark page sees the night colour, a light one the day
 * colour, and a browser without `light-dark()` drops the declaration and keeps the
 * attribute.
 *
 * The night colour is derived rather than declared, so every colour a figure can
 * carry — the palette's, a project's declared kind colour, one added later — has one
 * without anybody maintaining a second palette. What is kept is each colour's distance
 * from the ground, in OKLab lightness where distance is perceptual, with hue and chroma
 * unchanged: the white ground becomes the dark one, a pale fill a deep tint of the same
 * hue, dark ink light ink, and a kind still reads as the same colour as its swatch in
 * the key. A faint line stays faint and a strong one strong.
 */

/** Where white lands: zinc-900, the ground a Mermaid diagram sits on in the dark theme, so the two kinds of figure read as one family. */
const NIGHT_GROUND = 0.21;
/** Where black lands: light ink, short of pure white so it does not glare. */
const NIGHT_INK = 0.94;
/**
 * Below one, distance from the ground grows faster near it than far from it. A dark
 * ground has less room than a white one — black on white spans the whole range —
 * and shrinking every distance alike left strokes and ink too close to the ground to
 * read, while the palest fills only need to stay a shade off it.
 */
const DISTANCE_CURVE = 0.65;

type Lab = { l: number; a: number; b: number };

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
}

function oklabOf(red: number, green: number, blue: number): Lab {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Linear sRGB, possibly outside [0, 1] when the colour is out of gamut. */
function linearOf({ l: L, a, b }: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (channels: number[]) => channels.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);

function hexOf(channels: number[]): string {
  return `#${channels
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, channel))))) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const cache = new Map<string, string>();

/**
 * The night counterpart of a `#rgb` or `#rrggbb` colour; anything else — `none`,
 * `transparent`, a `url(…)` — is returned as it came, since it names no colour to turn.
 */
export function nightColour(colour: string): string {
  if (!HEX.test(colour)) return colour;
  const known = cache.get(colour);
  if (known !== undefined) return known;
  const digits = colour.length === 4 ? [...colour.slice(1)].map((digit) => digit + digit) : [1, 3, 5].map((at) => colour.slice(at, at + 2));
  const [red, green, blue] = digits.map((pair) => Number.parseInt(pair, 16) / 255);
  const day = oklabOf(red, green, blue);
  const distance = 1 - Math.min(1, Math.max(0, day.l));
  const lightness = NIGHT_GROUND + (NIGHT_INK - NIGHT_GROUND) * distance ** DISTANCE_CURVE;
  // Same hue; chroma given up only as far as the darker or lighter colour needs to
  // exist in sRGB, found by halving rather than clipped channel by channel, which
  // would shift the hue.
  let scale = 1;
  let channels = linearOf({ l: lightness, a: day.a, b: day.b });
  if (!inGamut(channels)) {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 20; step++) {
      scale = (low + high) / 2;
      if (inGamut(linearOf({ l: lightness, a: day.a * scale, b: day.b * scale }))) low = scale;
      else high = scale;
    }
    scale = low;
    channels = linearOf({ l: lightness, a: day.a * scale, b: day.b * scale });
  }
  const night = hexOf(channels);
  cache.set(colour, night);
  return night;
}

/** `light-dark(day, night)`, or undefined when there is no colour to turn. */
export function screenColour(colour: string | undefined): string | undefined {
  if (colour === undefined || !HEX.test(colour)) return undefined;
  return `light-dark(${colour}, ${nightColour(colour)})`;
}

/**
 * The inline style that paints a shape for the page's theme.
 *
 * Only the properties that carry a colour are set, so a shape with neither keeps no
 * `style` at all and serializes as it did.
 */
export function screenPaint(paint: { fill?: string; stroke?: string }): React.CSSProperties | undefined {
  const fill = screenColour(paint.fill);
  const stroke = screenColour(paint.stroke);
  if (fill === undefined && stroke === undefined) return undefined;
  return { ...(fill === undefined ? {} : { fill }), ...(stroke === undefined ? {} : { stroke }) };
}
