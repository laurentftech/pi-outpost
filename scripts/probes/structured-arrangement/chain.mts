/** structured-exchange-arrangement: a six-element chain's routes and label room, in both orientations. */
import { graphFigurePage } from "@pi-outpost/shared/structured-exchange/figure";
import { routeGraph } from "@pi-outpost/shared/structured-exchange/wiring";

const data = {
  nodes: Array.from({ length: 6 }, (_, index) => ({ id: `n${index}`, label: `Element ${index}`, kind: "part" })),
  edges: Array.from({ length: 5 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}`, kind: "feeds" })),
};
for (const orientation of ["landscape", "portrait"] as const) {
  for (const [index, wire] of routeGraph(graphFigurePage(data, { orientation }))) console.log(orientation, index, JSON.stringify(wire.points), wire.span, JSON.stringify(wire.labelAt));
}
