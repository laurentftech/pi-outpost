/**
 * structured-exchange-arrangement: drawio_check's report on a graph's figure page, after the
 * cleanup, and the page as draw.io XML — to see what the rules still say.
 *
 *   npx tsx scripts/probes/structured-arrangement/report.mts <document.json|vehicle>
 */
import { readFile } from "node:fs/promises";
import { checkPages, describeDrawioReport } from "@pi-outpost/shared/drawio/check";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

const source = process.argv[2] ?? "vehicle";
const data: StructuredGraphData = source === "vehicle"
  ? (await import("./vehicle.mts")).vehicle
  : JSON.parse(await readFile(source, "utf8")).data;
const page = graphFigurePage(data);
console.log(describeDrawioReport(source, checkPages([page])));
if (process.env.XML) console.log(writeDrawio(page));
if (process.env.ROUNDS) {
  const { followAdvice } = await import("@pi-outpost/shared/drawio/follow-advice");
  const result = followAdvice(writeDrawio(page), 12, (round, anchors) => {
    for (const message of anchors) console.log(`[round ${round}] ${message.slice(0, 220)}`);
  }, { moveShapes: false });
  console.log(`rounds ${result.rounds}, converged ${result.converged}, looped ${result.looped}`);
}
