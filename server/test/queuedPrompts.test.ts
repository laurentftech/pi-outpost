/**
 * The queue tracker against the shapes pi reports: one change per `queue_update` — an
 * append, or the removal of the first entry with the text it delivered — and a
 * `clearQueue()` that gives the texts back. pi's strings are its *expanded* texts, which
 * is why a source is matched by expectation and never by text.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueuedPrompts, type QueuedPromptSource } from "../src/queuedPrompts.ts";

const IMAGE = { data: "aGVsbG8=", mimeType: "image/png" };

function source(text: string, extra: Partial<QueuedPromptSource> = {}): QueuedPromptSource {
  return { text, promptText: text, ...extra };
}

/** Send a prompt pi queues as `piText`, the way the server does: expect, report, settle. */
function queue(tracker: QueuedPrompts, lists: { steering: string[]; followUp?: string[] }, src: QueuedPromptSource) {
  const expectation = tracker.expect(src);
  const result = tracker.update({ steering: lists.steering, followUp: lists.followUp ?? [] });
  tracker.settle(expectation, true);
  return result;
}

describe("QueuedPrompts", () => {
  test("a queued prompt is shown as typed, with its images, and editable", () => {
    const tracker = new QueuedPrompts();
    const { changed, delivered } = queue(tracker, { steering: ["<skill body> fix it"] }, source("/skill:fix fix it", { images: [IMAGE] }));
    assert.equal(changed, true);
    assert.deepEqual(delivered, []);
    const [view] = tracker.view(true);
    assert.equal(view.text, "/skill:fix fix it", "the text the user typed, not pi's expansion");
    assert.deepEqual(view.images, [IMAGE]);
    assert.equal(view.kind, "steer");
    assert.equal(view.editable, true);
  });

  test("a prompt pi delivers is reported once, with its source, and leaves the list", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["first"] }, source("first", { images: [IMAGE] }));
    queue(tracker, { steering: ["first", "second"] }, source("second"));
    const { delivered, changed } = tracker.update({ steering: ["second"], followUp: [] });
    assert.equal(changed, true);
    assert.deepEqual(delivered.map((entry) => entry.source), [source("first", { images: [IMAGE] })]);
    assert.deepEqual(tracker.view(true).map((view) => view.text), ["second"]);
    assert.deepEqual(tracker.update({ steering: ["second"], followUp: [] }).delivered, [], "reported once");
  });

  test("of two identical prompts, the first is the one delivered, as pi removes the first", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["same"] }, source("same", { images: [IMAGE] }));
    queue(tracker, { steering: ["same", "same"] }, source("same"));
    const { delivered } = tracker.update({ steering: ["same"], followUp: [] });
    assert.deepEqual(delivered.map((entry) => entry.source?.images), [[IMAGE]]);
    assert.equal(tracker.view(true)[0].images, undefined, "the second, without the image, is still queued");
  });

  test("a prompt pi did not queue leaves no expectation behind", () => {
    const tracker = new QueuedPrompts();
    const started = tracker.expect(source("ran at once"));
    tracker.settle(started, false);
    tracker.update({ steering: ["from an extension"], followUp: [] });
    const [view] = tracker.view(true);
    assert.equal(view.text, "from an extension");
    assert.equal(view.editable, false, "foreign: nothing typed it here");
  });

  test("an extension's message queued while ours is in flight is not taken for ours", () => {
    const tracker = new QueuedPrompts();
    const ours = tracker.expect(source("mine"));
    // The extension's follow-up lands first, then our steer.
    tracker.update({ steering: [], followUp: ["from an extension"] });
    tracker.update({ steering: ["mine"], followUp: ["from an extension"] });
    tracker.settle(ours, true);
    assert.deepEqual(tracker.view(true).map(({ text, kind }) => [text, kind]), [["mine", "steer"], ["from an extension", "followUp"]]);
    assert.equal(tracker.find(tracker.view(true)[0].id)?.source?.text, "mine");
    assert.equal(tracker.find(tracker.view(true)[1].id)?.source, undefined, "the extension's is foreign");
  });

  test("of two prompts in flight, the one whose text pi kept is matched first", () => {
    const tracker = new QueuedPrompts();
    tracker.expect(source("/skill:x expand me"));
    tracker.expect(source("plain"));
    tracker.update({ steering: ["plain"], followUp: [] });
    assert.equal(tracker.view(true)[0].text, "plain");
  });

  test("an expectation settled after pi's report still names its entry", () => {
    // RPC: the child's queue_update can be handled before or after the prompt's response.
    const tracker = new QueuedPrompts();
    const expectation = tracker.expect(source("typed"));
    tracker.update({ steering: ["expanded"], followUp: [] });
    tracker.settle(expectation, true);
    assert.equal(tracker.view(true)[0].text, "typed");
  });

  test("a foreign entry makes every queued prompt read-only", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["mine"] }, source("mine"));
    tracker.update({ steering: ["mine"], followUp: ["an extension's"] });
    assert.equal(tracker.hasForeign, true);
    assert.deepEqual(tracker.view(true).map((view) => [view.text, view.kind, view.editable]), [
      ["mine", "steer", false],
      ["an extension's", "followUp", false],
    ]);
  });

  test("a runtime that cannot rewrite its queue shows it read-only", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["mine"] }, source("mine"));
    assert.equal(tracker.view(false)[0].editable, false);
  });

  test("while suspended, the take-back's empty queue is not a delivery", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["a"] }, source("a"));
    queue(tracker, { steering: ["a", "b"] }, source("b"));
    tracker.suspend();
    assert.deepEqual(tracker.update({ steering: [], followUp: [] }), { delivered: [], changed: false });
    const { delivered, kept } = tracker.takeBack({ steering: ["a", "b"], followUp: [] });
    assert.deepEqual(delivered, []);
    assert.deepEqual(kept.map((entry) => entry.source?.text), ["a", "b"], "in queue order");
    assert.equal(tracker.size, 0, "empty until the caller queues them again");
  });

  test("what the take-back did not return was delivered just before", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["a"] }, source("a"));
    queue(tracker, { steering: ["a", "b"] }, source("b"));
    const target = tracker.view(true)[0].id;
    tracker.suspend();
    const { delivered, kept } = tracker.takeBack({ steering: ["b"], followUp: [] });
    assert.deepEqual(delivered.map((entry) => entry.id), [target]);
    assert.deepEqual(kept.map((entry) => entry.source?.text), ["b"]);
  });

  test("after a take-back, re-queued prompts are matched to their sources again", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["a"] }, source("a"));
    tracker.suspend();
    tracker.takeBack({ steering: ["a"], followUp: [] });
    queue(tracker, { steering: ["a edited"] }, source("a edited"));
    assert.deepEqual(tracker.view(true).map((view) => view.text), ["a edited"]);
  });

  test("a prompt queued again after a take-back keeps its id", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["a"] }, source("a"));
    queue(tracker, { steering: ["a", "b"] }, source("b"));
    const ids = tracker.view(true).map((view) => view.id);
    tracker.suspend();
    const { kept } = tracker.takeBack({ steering: ["a", "b"], followUp: [] });
    for (const [i, entry] of kept.entries()) {
      const expectation = tracker.expect(entry.source!, { id: entry.id });
      tracker.update({ steering: kept.slice(0, i + 1).map((e) => e.piText), followUp: [] });
      tracker.settle(expectation, true);
    }
    assert.deepEqual(tracker.view(true).map((view) => view.id), ids);
  });

  test("a failed take-back reads reports again", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["a"] }, source("a"));
    tracker.suspend();
    tracker.resume();
    assert.equal(tracker.update({ steering: [], followUp: [] }).delivered.length, 1);
  });

  test("a new session forgets the queue and the expectations", () => {
    const tracker = new QueuedPrompts();
    queue(tracker, { steering: ["a"] }, source("a"));
    tracker.expect(source("pending"));
    tracker.reset();
    assert.equal(tracker.size, 0);
    tracker.update({ steering: ["x"], followUp: [] });
    assert.equal(tracker.view(true)[0].editable, false, "the old expectation is gone");
  });
});
