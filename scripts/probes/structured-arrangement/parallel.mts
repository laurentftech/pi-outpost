/** structured-exchange-arrangement: five relationships between one pair, before and after the cleanup's rounds. */
import { checkPages } from "@pi-outpost/shared/drawio/check";
import { followAdvice } from "@pi-outpost/shared/drawio/follow-advice";
import { writeDrawio } from "@pi-outpost/shared/drawio/write";
import { graphPage, rankEnds, spreadParallelEnds } from "@pi-outpost/shared/structured-exchange/wiring";

const boxes = new Map([["a", { x: 20, y: 20, width: 120, height: 29 }], ["b", { x: 210, y: 20, width: 120, height: 29 }]]);
const wired = ["one", "two", "three", "four", "five"].map((label, index) => ({ index, from: index < 3 ? "a" : "b", to: index < 3 ? "b" : "a", label }));
const spread = spreadParallelEnds(boxes, wired);
const withEnds = wired.map((relationship) => ({ ...relationship, ends: spread.get(relationship.index) }));
const ranked = rankEnds(boxes, withEnds, false);
const page = graphPage(boxes, withEnds.map((relationship) => ({ ...relationship, ends: relationship.ends ?? ranked.get(relationship.index) })));
for (const issue of checkPages([page]).issues) console.log("before:", issue.message.slice(0, 260));
followAdvice(writeDrawio(page), 12, (round, anchors) => anchors.forEach((message) => console.log(`[${round}]`, message.slice(0, 260))), { moveShapes: false });
