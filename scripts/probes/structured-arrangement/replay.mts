/**
 * structured-exchange-arrangement: replay a graph and an arrangement through everything the view
 * computes — figure, arrangement check, a move — timing each, to find what hangs.
 *
 *   npx tsx scripts/probes/structured-arrangement/replay.mts <document.json> <arrangement.json>
 */
import { readFile } from "node:fs/promises";
import { graphFigure, arrangedGraph } from "@pi-outpost/shared/structured-exchange/figure";
import { checkArrangement } from "@pi-outpost/shared/structured-exchange/arrangement-check";
import { readArrangement } from "@pi-outpost/shared/structured-exchange/arrangement";
import { moveInView } from "@pi-outpost/shared/structured-exchange/placement";

const [documentFile, arrangementFile] = process.argv.slice(2);
const data = JSON.parse(await readFile(documentFile!, "utf8")).data;
const reading = readArrangement(await readFile(arrangementFile!, "utf8"));
if (!reading.ok) throw new Error(reading.reason);
const view = reading.arrangement.views[""];
const step = (name: string, run: () => unknown) => {
  const start = performance.now();
  run();
  console.log(`${name}: ${(performance.now() - start).toFixed(0)} ms`);
};
step("figure", () => graphFigure(data, { isProposal: false, arrangement: view! }));
step("check", () => checkArrangement(data, { arrangement: view! }));
const { shown, page } = arrangedGraph(data, { arrangement: view! });
step("move", () => moveInView(shown, page, view, "ecu", { x: 20, y: 100 }, "landscape"));
