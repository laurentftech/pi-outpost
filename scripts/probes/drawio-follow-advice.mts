/**
 * drawio-wire-anchors: does following drawio_check's anchor advice to the letter converge? See
 * shared/src/drawio/followAdvice.ts. A loop here is pi-outpost's advice contradicting itself,
 * not a model failing to apply it.
 *
 *   npx tsx scripts/probes/drawio-follow-advice.mts <file.drawio>...    (VERBOSE=1 for each round)
 */
import { readFile } from "node:fs/promises";
import { checkDrawio } from "../../server/src/drawio.ts";
import { ANCHOR, followAdvice } from "@pi-outpost/shared/drawio/follow-advice";

for (const file of process.argv.slice(2)) {
  const result = followAdvice(await readFile(file, "utf8"), 12, (round, anchors) => {
    if (process.env.VERBOSE) for (const message of anchors) console.log(`  [round ${round}] ${message.slice(0, 400)}`);
  });
  const rest = checkDrawio(result.xml).issues.filter((issue) => !ANCHOR.test(issue.message)).length;
  const verdict = result.converged ? "no anchor warning left" : `${result.looped ? "LOOP" : "advice ran dry"}: ${result.left.map((m) => m.slice(0, 140)).join(" | ")}`;
  console.log(`${file.split("/").pop()}: ${result.rounds} round(s), ${verdict}; ${rest} other issue(s) (crossings, labels, shapes) left`);
}
