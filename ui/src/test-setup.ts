import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements no layout, so it ships no scrollIntoView. Components that keep a
// selected row in view call it on every selection change; without this they throw
// during render and the test reports a crash rather than the behaviour it asked about.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
});
