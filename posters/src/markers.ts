/**
 * Pictures kept out of what the model reads, and put back in what it writes (poster-elements:
 * TheModelSeesMarkersNotPictureData, MarkersAreRestoredOnWrite).
 *
 * A picture the person adds is embedded in the poster as a data URL of a few hundred kB. Handed
 * to the model as it is, it would fill its context with base64; and a model rewriting the poster
 * from what it read would have to copy it back, which it cannot do. So every host shows each
 * embedded picture as a short marker, `poster-picture:N`, numbered in document order, and turns
 * markers back into the pictures they stand for before checking and writing what the model sent.
 *
 * Isomorphic: no Node and no DOM.
 */
import { PosterRefusal } from "./format.ts";

/** Every embedded picture: a data URL of an image, up to the quote, parenthesis or space ending it. */
const PICTURE = /data:image\/[^"'()\s]+/g;
const MARKER = /poster-picture:(\d+)/g;
/** The inventory written at the top of the markup, for the model to know which picture is which. */
const INVENTORY = /<!-- poster pictures:[^>]*-->\n?/g;

export interface HiddenPictures {
  html: string;
  css: string;
  /** The pictures the markers stand for: `poster-picture:1` is the first. */
  pictures: string[];
}

/** What a marker is called for the model: the slot it fills, else the picture's alternative text. */
function nameAt(html: string, index: number): string | undefined {
  const start = html.lastIndexOf("<", index);
  const end = html.indexOf(">", index);
  if (start === -1 || end === -1) return undefined;
  const tag = html.slice(start, end);
  return /data-poster-picture="([^"]*)"/.exec(tag)?.[1] || /\balt="([^"]+)"/.exec(tag)?.[1] || undefined;
}

function sizeOf(picture: string): string {
  const comma = picture.indexOf(",");
  const bytes = picture.slice(0, comma).endsWith(";base64") ? Math.floor(((picture.length - comma - 1) * 3) / 4) : picture.length - comma - 1;
  return `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

/**
 * The poster with each embedded picture replaced by `poster-picture:N`, in the markup's
 * attributes and the stylesheet's `url()` alike, and a one-line inventory at the top of the
 * markup naming each. A poster without pictures comes back exactly as it was.
 */
export function hidePictures(html: string, css: string): HiddenPictures {
  const pictures: string[] = [];
  const names: Array<string | undefined> = [];
  const hide = (text: string, named: boolean) =>
    text.replace(PICTURE, (picture, index: number) => {
      pictures.push(picture);
      names.push(named ? nameAt(text, index) : "in the stylesheet");
      return `poster-picture:${pictures.length}`;
    });
  const hiddenHtml = hide(html.replace(INVENTORY, ""), true);
  const hiddenCss = hide(css, false);
  if (pictures.length === 0) return { html, css, pictures };
  const entries = pictures.map((picture, index) => `poster-picture:${index + 1}${names[index] ? ` (${names[index]})` : ""} ${sizeOf(picture)}`);
  const inventory = `<!-- poster pictures: ${entries.join("; ")}. Each marker stands for a picture the person added; keep it exactly as it is to keep the picture, remove it to remove the picture. -->\n`;
  return { html: inventory + hiddenHtml, css: hiddenCss, pictures };
}

/**
 * The poster with each `poster-picture:N` replaced by the picture it stands for, and the
 * inventory removed. A marker naming no picture is refused with its name; a picture whose
 * marker is gone is simply not in the result.
 */
export function restorePictures(html: string, css: string, pictures: readonly string[]): { html: string; css: string } {
  const restore = (text: string) =>
    text.replace(MARKER, (marker, number: string) => {
      const picture = pictures[Number(number) - 1];
      if (picture === undefined) {
        throw new PosterRefusal(
          `${marker} names no picture of this poster${pictures.length ? ` (it has poster-picture:1 to poster-picture:${pictures.length})` : " (it has none)"}: keep the markers exactly as you read them`,
          { marker, pictures: pictures.length },
        );
      }
      return picture;
    });
  return { html: restore(html.replace(INVENTORY, "")), css: restore(css) };
}
