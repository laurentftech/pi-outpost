/**
 * The model's image limits (#526): reading them, and keeping a request within them.
 * The whole path — a gateway refusing more — is in imageLimitWire.test.mjs.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { imagesPerMessage, imagesPerRequest, omittedImageNote, picturesPerResult, withinImageLimits } from "../src/modelImageLimit.ts";

const image = (id: string) => ({ type: "image", data: id, mimeType: "image/png" });
const text = (value: string) => ({ type: "text", text: value });
const user = (...content: object[]) => ({ role: "user", content });
const result = (...content: object[]) => ({ role: "toolResult", content });
const imagesOf = (messages: { content?: unknown }[]) =>
  messages.flatMap((message) => (Array.isArray(message.content) ? message.content : [])).filter((block) => block.type === "image").map((block) => block.data);

describe("the limits a model declares", () => {
  test("are read from inputLimits.images, and a malformed one is no limit", () => {
    const model = { inputLimits: { images: { maxPerRequest: 4, maxPerMessage: 2 } } };
    assert.equal(imagesPerRequest(model), 4);
    assert.equal(imagesPerMessage(model), 2);
    assert.equal(imagesPerMessage({ inputLimits: { images: { maxPerRequest: 4 } } }), 4, "a request's limit bounds each message too");
    assert.equal(imagesPerMessage({ inputLimits: { images: { maxPerRequest: 3, maxPerMessage: 6 } } }), 3);
    for (const bad of [0, -1, 2.5, "4", null]) {
      assert.equal(imagesPerRequest({ inputLimits: { images: { maxPerRequest: bad } } }), undefined, String(bad));
    }
    assert.equal(imagesPerRequest(undefined), undefined, "no model, no limit");
    assert.equal(imagesPerRequest({ id: "plain" }), undefined);
  });

  test("bound what one tool result returns, under the tool's own cap", () => {
    assert.equal(picturesPerResult({ inputLimits: { images: { maxPerRequest: 4 } } }, 8), 4);
    assert.equal(picturesPerResult({ inputLimits: { images: { maxPerRequest: 20 } } }, 8), 8);
    assert.equal(picturesPerResult(undefined, 8), 8);
  });
});

describe("withinImageLimits", () => {
  test("leaves a request within the limits untouched, as the same array", () => {
    const messages = [user(text("hi"), image("a")), result(image("b"))];
    assert.equal(withinImageLimits(messages, 4, undefined), messages);
    assert.equal(withinImageLimits(messages, undefined, undefined), messages);
  });

  test("keeps the newest images across the request, and says where the others were", () => {
    const messages = [user(image("a"), image("b")), result(text("x"), image("c"), image("d")), result(image("e"))];
    const out = withinImageLimits(messages, 3, undefined);
    assert.deepEqual(imagesOf(out), ["c", "d", "e"], "the three newest stay");
    assert.deepEqual(out[0].content, [text(omittedImageNote(3)), text(omittedImageNote(3))], "each image left out leaves its line");
    assert.match(omittedImageNote(3), /at most 3 images per request/);
  });

  test("holds each message to the per-message limit, keeping its last images", () => {
    const messages = [result(image("a"), image("b"), image("c"))];
    assert.deepEqual(imagesOf(withinImageLimits(messages, undefined, 2)), ["b", "c"]);
  });

  test("never rewrites the stored conversation", () => {
    const messages = [user(image("a")), result(image("b"))];
    const snapshot = JSON.stringify(messages);
    withinImageLimits(messages, 1, undefined);
    assert.equal(JSON.stringify(messages), snapshot);
  });

  test("passes over messages without images, whatever their content", () => {
    const messages = [{ role: "assistant", content: "plain" }, { role: "user" }, user(image("a"), image("b"))];
    const out = withinImageLimits(messages, 1, undefined);
    assert.equal(out[0], messages[0]);
    assert.equal(out[1], messages[1]);
    assert.deepEqual(imagesOf(out), ["b"]);
  });
});
