/**
 * How a picture is named in an extraction, and what it costs to send its bytes.
 *
 * The marker is the part every caller sees whether it asked for pictures or not, so
 * it carries the same weight as the budget: get it wrong and either the text becomes
 * unreadable, or a document's pictures go unmentioned again.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  MAX_MARKERS,
  MAX_ONE_PICTURE_BYTES,
  MAX_PICTURES_PER_CALL,
  MAX_PICTURE_BYTES_PER_CALL,
  pictureMarker,
  pictureMarkers,
  pictureNumberOf,
  selectPictures,
  type FoundPicture,
} from "../src/extractedPictures.ts";

/** A returnable picture of a given size, so budget tests read as intent. */
function picture(number: number, bytes: number, extra: Partial<FoundPicture> = {}): FoundPicture {
  return { number, format: "PNG", width: 10, height: 10, bytes: Buffer.alloc(bytes), mimeType: "image/png", ...extra };
}

describe("the marker", () => {
  test("names the format, the size and the alt text", () => {
    assert.equal(
      pictureMarker({ number: 3, format: "PNG", width: 800, height: 600, alt: "Revenue by region" }),
      '[picture 3: PNG 800×600 — "Revenue by region"]',
    );
  });

  test("leaves out what the document does not say", () => {
    assert.equal(pictureMarker({ number: 1, format: "PNG", width: 800, height: 600 }), "[picture 1: PNG 800×600]");
    assert.equal(pictureMarker({ number: 2, format: "JPEG" }), "[picture 2: JPEG]");
    // Empty alt text is the same as none: a marker ending in — "" says nothing.
    assert.equal(pictureMarker({ number: 4, format: "GIF", alt: "   " }), "[picture 4: GIF]");
  });

  test("a picture whose bytes cannot travel is still named, with the reason", () => {
    assert.equal(
      pictureMarker({ number: 5, format: "EMF", width: 120, height: 60, unavailable: "EMF cannot be shown as an image" }),
      "[picture 5: EMF 120×60; EMF cannot be shown as an image]",
    );
  });

  test("alt text cannot break the marker it sits in", () => {
    // A `]` would end the marker early and leave the rest as loose prose; a newline
    // would split it across blocks.
    const marker = pictureMarker({ number: 1, format: "PNG", alt: 'Chart [2024]\nfor "Q3"\tsales' });
    assert.equal(marker, "[picture 1: PNG — \"Chart 2024 for 'Q3' sales\"]");
    assert.equal(marker.indexOf("]"), marker.length - 1, "exactly one closing bracket, at the end");
    assert.doesNotMatch(marker, /[\r\n\t]/);
  });

  test("alt text that is a paragraph is capped to a label", () => {
    const marker = pictureMarker({ number: 1, format: "PNG", alt: "x".repeat(400) });
    assert.ok(marker.length < 160, `a label, not a paragraph: ${marker.length} chars`);
    assert.match(marker, /…"\]$/);
  });
});

describe("marker volume", () => {
  test("every picture is named while there are few enough", () => {
    const found = Array.from({ length: MAX_MARKERS }, (_, i) => picture(i + 1, 10));
    assert.equal(pictureMarkers(found).length, MAX_MARKERS);
  });

  test("past the cap the markers give way to a count that still says how to reach them", () => {
    const found = Array.from({ length: MAX_MARKERS + 5 }, (_, i) => picture(i + 1, 10));
    const markers = pictureMarkers(found);
    assert.equal(markers.length, MAX_MARKERS + 1);
    assert.equal(markers[MAX_MARKERS], `[and 5 further pictures, numbered ${MAX_MARKERS + 1}–${MAX_MARKERS + 5}]`);
  });

  test("one picture past the cap reads as one, not as 1 pictures", () => {
    const found = Array.from({ length: MAX_MARKERS + 1 }, (_, i) => picture(i + 1, 10));
    assert.match(pictureMarkers(found)[MAX_MARKERS], /1 further picture, numbered/);
  });
});

describe("identifiers", () => {
  test("a number is read from any spelling the marker could have suggested", () => {
    for (const spelling of ["3", " 3 ", "picture 3", "picture-3", "Picture 3", "picture3", "PICTURE  3"]) {
      assert.equal(pictureNumberOf(spelling), 3, spelling);
    }
  });

  test("what is not a picture number is not one", () => {
    for (const bad of ["", "picture", "0", "-1", "3.5", "3 4", "image 3", "picture 3a", "9007199254740993"]) {
      assert.equal(pictureNumberOf(bad), undefined, bad);
    }
  });
});

describe("what travels, and what is said about the rest", () => {
  test('"none" sends no bytes and says nothing', () => {
    assert.deepEqual(selectPictures([picture(1, 10), picture(2, 10)], "none"), { returned: [], notes: [] });
  });

  test('"all" sends every picture that fits, in document order', () => {
    const found = [picture(1, 10), picture(2, 10), picture(3, 10)];
    const chosen = selectPictures(found, "all");
    assert.deepEqual(chosen.returned.map((p) => p.number), [1, 2, 3]);
    assert.deepEqual(chosen.notes, []);
  });

  test("a named picture is returned and nothing else is", () => {
    const chosen = selectPictures([picture(1, 10), picture(2, 10), picture(3, 10)], ["picture 2"]);
    assert.deepEqual(chosen.returned.map((p) => p.number), [2]);
  });

  test("an identifier naming no picture is refused, and the message names it", () => {
    assert.throws(
      () => selectPictures([picture(1, 10), picture(2, 10)], ["picture 9"]),
      (error: unknown) => error instanceof Error && /No picture "picture 9"\. This document holds 2, numbered 1–2\./.test(error.message),
    );
    assert.throws(
      () => selectPictures([], ["1"]),
      (error: unknown) => error instanceof Error && /this document holds no pictures/.test(error.message),
    );
    // A malformed identifier is refused the same way, rather than silently ignored.
    assert.throws(() => selectPictures([picture(1, 10)], ["the big one"]), /No picture "the big one"/);
  });

  test("a picture with no bytes is skipped silently here — its marker already says why", () => {
    const found = [picture(1, 10), { number: 2, format: "EMF", unavailable: "EMF cannot be shown as an image" }];
    const chosen = selectPictures(found, "all");
    assert.deepEqual(chosen.returned.map((p) => p.number), [1]);
    assert.deepEqual(chosen.notes, []);
  });

  test("the per-call count cap holds, and the answer says how many were left and where to resume", () => {
    const found = Array.from({ length: MAX_PICTURES_PER_CALL + 3 }, (_, i) => picture(i + 1, 10));
    const chosen = selectPictures(found, "all");
    assert.equal(chosen.returned.length, MAX_PICTURES_PER_CALL);
    assert.equal(chosen.notes.length, 1);
    assert.match(chosen.notes[0], /^3 further pictures did not fit this answer/);
    assert.match(chosen.notes[0], new RegExp(`starting at ${MAX_PICTURES_PER_CALL + 1}\\.$`));
  });

  test("the per-call byte cap holds even when the count would allow more", () => {
    // Each under the per-picture ceiling, so only the per-call total can stop them:
    // three of these are 4.5 MB against a 4 MB budget.
    const each = Math.floor(MAX_PICTURE_BYTES_PER_CALL * 0.375);
    assert.ok(each < MAX_ONE_PICTURE_BYTES, "the fixture must not trip the per-picture ceiling instead");
    const chosen = selectPictures([picture(1, each), picture(2, each), picture(3, each)], "all");
    assert.deepEqual(chosen.returned.map((p) => p.number), [1, 2], "two fit, the third does not");
    assert.equal(chosen.returned.length < MAX_PICTURES_PER_CALL, true, "the count cap was not what stopped it");
    assert.match(chosen.notes[0], /1 further picture did not fit this answer/);
    assert.match(chosen.notes[0], /starting at 3\./);
  });

  test('a picture over the per-picture ceiling waits for its own call under "all"', () => {
    const found = [picture(1, MAX_ONE_PICTURE_BYTES + 1), picture(2, 10)];
    const chosen = selectPictures(found, "all");
    assert.deepEqual(chosen.returned.map((p) => p.number), [2], "the big one does not starve the small one");
    assert.equal(chosen.notes.length, 1);
    assert.match(chosen.notes[0], /^Picture 1 is over 2 MB and did not travel with the rest\./);
    assert.match(chosen.notes[0], /Ask for it by number/);
  });

  test("naming that picture is the way to get it, whatever its size", () => {
    const big = picture(1, MAX_ONE_PICTURE_BYTES + 1);
    const chosen = selectPictures([big, picture(2, 10)], ["1"]);
    assert.deepEqual(chosen.returned.map((p) => p.number), [1]);
    assert.deepEqual(chosen.notes, [], "no note: nothing was withheld from what was asked");
  });

  test("several oversized pictures read as a list, in one sentence", () => {
    const found = [picture(1, MAX_ONE_PICTURE_BYTES + 1), picture(2, MAX_ONE_PICTURE_BYTES + 1), picture(3, 10)];
    const chosen = selectPictures(found, "all");
    assert.deepEqual(chosen.returned.map((p) => p.number), [3]);
    assert.match(chosen.notes[0], /^Pictures 1, 2 are over 2 MB/);
    assert.match(chosen.notes[0], /Ask for them by number to get them\.$/);
  });
});
