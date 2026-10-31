/** structured-exchange-arrangement: one round of advice on the vehicle page, each kind of fix shown, and what changed. */
import { checkPages } from "@pi-outpost/shared/drawio/check";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import * as follow from "@pi-outpost/shared/drawio/follow-advice";
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { vehicle } from "./vehicle.mts";

const page = graphFigurePage(vehicle);
const xml = writeDrawio(page);
const messages = checkPages([page]).issues.map((issue) => issue.message);
console.log("advice", JSON.stringify([...follow.advice(messages)]));
console.log("fixes", JSON.stringify(follow.waypointFixes(messages)));
console.log("sets", JSON.stringify(follow.waypointSets(messages)));
console.log("adds", JSON.stringify(follow.addedWaypoints(messages)));
const next = follow.applyWaypointSets(follow.applyAddedWaypoints(follow.applyLabelMoves(follow.applyWaypointFixes(follow.stripWaypoints(follow.apply(xml, follow.advice(messages)), follow.dropWaypoints(messages)), follow.waypointFixes(messages)), follow.labelMoves(messages)), follow.addedWaypoints(messages)), follow.waypointSets(messages));
const before = xml.split("\n");
for (const [index, line] of next.split("\n").entries()) if (line !== before[index]) console.log(`- ${before[index]}\n+ ${line}`);
console.log("changed:", next !== xml, "lines", before.length, next.split("\n").length);
console.log(xml.split("\n").filter((line) => line.includes('id="r:12"') || line.includes('id="r:9"')).join("\n"));
console.log(next.split("\n").filter((line) => line.includes('id="r:12"') || line.includes('id="r:9"')).join("\n"));
