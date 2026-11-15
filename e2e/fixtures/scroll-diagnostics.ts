/**
 * A timeline of what moved a scroller, attached to a test only when it fails.
 *
 * Scroll bugs that only show in CI are a question of order: which scroll, resize or
 * programmatic jump happened first. A screenshot shows where the page ended up, not
 * how it got there, and a runner slower than any developer machine produces orders
 * no local run does. This records them from inside the page, without touching the
 * product: every scroll and scrollend of the scroller, every `scrollIntoView` with
 * the frames that called it, every resize the scroller or its content reports, and
 * when a watched element appears or disappears.
 *
 * Found the return-to-latest flake (#498) on its first CI pass, after local runs
 * at any CPU throttle never reproduced it.
 *
 *   test.beforeEach(({ page }) => recordScrollDiagnostics(page, { watch: 'button[aria-label="…"]' }));
 *   test.afterEach(({ page }, testInfo) => attachScrollDiagnostics(page, testInfo));
 */
import fs from "node:fs";
import type { Page, TestInfo } from "@playwright/test";

export interface ScrollDiagnosticsOptions {
  /** The scrolling element, by tag name (upper case, as `tagName` reports it). */
  scrollerTag?: string;
  /** A selector whose presence is logged each time it changes. */
  watch?: string;
}

type DiagnosticsWindow = Window & { __scrollLog?: string[]; __scrollNote?: (what: string) => void };

/** Installs the recorder; call before the page navigates. */
export async function recordScrollDiagnostics(page: Page, options: ScrollDiagnosticsOptions = {}): Promise<void> {
  await page.addInitScript(({ scrollerTag, watch }) => {
    const w = window as DiagnosticsWindow;
    const log: string[] = [];
    w.__scrollLog = log;
    const t0 = performance.now();
    const geometry = () => {
      const scroller = document.querySelector(scrollerTag.toLowerCase());
      if (!scroller) return "no scroller";
      const watched = watch ? ` watched=${document.querySelector(watch) ? 1 : 0}` : "";
      return `top=${Math.round(scroller.scrollTop)} max=${scroller.scrollHeight - scroller.clientHeight}${watched}`;
    };
    const note = (what: string) => {
      log.push(`${Math.round(performance.now() - t0)}ms ${what} | ${geometry()}`);
    };
    w.__scrollNote = note;
    const onScroller = (e: Event) => (e.target as Element | null)?.tagName === scrollerTag;
    document.addEventListener("scroll", (e) => onScroller(e) && note("scroll"), true);
    document.addEventListener("scrollend", (e) => onScroller(e) && note("scrollend"), true);
    document.addEventListener("wheel", () => note("wheel"), true);
    const scrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (arg?: boolean | ScrollIntoViewOptions) {
      const from = (new Error().stack ?? "")
        .split("\n")
        .slice(2, 5)
        .map((line) => line.trim().replace(/https?:\/\/[^/]+/, ""))
        .join(" < ");
      note(`scrollIntoView(${JSON.stringify(arg)}) on ${this.tagName} from ${from}`);
      return scrollIntoView.call(this, arg as ScrollIntoViewOptions);
    };
    const Observer = window.ResizeObserver;
    window.ResizeObserver = class extends Observer {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => {
          const ours = entries.filter((entry) => entry.target.tagName === scrollerTag || entry.target.parentElement?.tagName === scrollerTag);
          if (ours.length) note(`resize ${ours.map((entry) => `${entry.target.tagName}:${Math.round(entry.contentRect.height)}`).join(",")}`);
          callback(entries, observer);
        });
      }
    };
    if (watch) {
      let present: boolean | undefined;
      new MutationObserver(() => {
        const now = !!document.querySelector(watch);
        if (now !== present) {
          present = now;
          note(`watched ${now ? "appears" : "disappears"}`);
        }
      // The document itself: an init script runs before the page's own root element
      // exists, and an observer on an element that is then replaced hears nothing.
      }).observe(document, { childList: true, subtree: true });
    }
  }, { scrollerTag: options.scrollerTag ?? "MAIN", watch: options.watch ?? "" });
}

/** Marks a step of the test in the timeline, e.g. just before it sets `scrollTop`. */
export async function noteScroll(page: Page, what: string): Promise<void> {
  await page.evaluate((text) => (window as DiagnosticsWindow).__scrollNote?.(`TEST ${text}`), what);
}

/** The timeline so far. */
export async function readScrollDiagnostics(page: Page): Promise<string[]> {
  return page.evaluate(() => [...((window as DiagnosticsWindow).__scrollLog ?? [])]);
}

/**
 * On a failure, attaches the timeline to the report, writes it beside the trace
 * (CI uploads `test-results/`), and prints it so the job log carries it too.
 * Does nothing when the test passed.
 */
export async function attachScrollDiagnostics(page: Page, testInfo: TestInfo): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) return;
  const log = await readScrollDiagnostics(page)
    .then((lines) => lines.join("\n"))
    .catch((error: unknown) => `scroll diagnostics unavailable: ${String(error)}`);
  await testInfo.attach("scroll-diagnostics", { body: log, contentType: "text/plain" });
  fs.writeFileSync(testInfo.outputPath("scroll-diagnostics.txt"), log);
  console.log(`SCROLL DIAGNOSTICS: ${testInfo.title}\n${log}\nSCROLL DIAGNOSTICS END`);
}
