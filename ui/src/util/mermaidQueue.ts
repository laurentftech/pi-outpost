/**
 * One mermaid at a time, for the whole page.
 *
 * `mermaid.initialize()` is global to the module and a render reads it while it runs,
 * so two callers that configure it differently cannot overlap: the viewer draws for
 * the screen, the Word export draws for a printed page, and an export pressed while
 * the viewer was still drawing the same document failed its diagram and silently
 * wrote it as source. Every caller that initialises and renders goes through here,
 * and sets the configuration it needs inside its turn.
 */
let tail: Promise<unknown> = Promise.resolve();

export function withMermaid<T>(work: () => Promise<T>): Promise<T> {
  const mine = tail.then(work, work);
  // The queue must not reject: a failed render still has to release the next one.
  tail = mine.then(
    () => undefined,
    () => undefined,
  );
  return mine;
}
