/** structured-exchange-arrangement: how long a graph's figure takes, cleanup included, on the corpus and on larger generated graphs. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { graphFigure } from "@pi-outpost/shared/structured-exchange/figure";
import type { StructuredGraphData } from "@pi-outpost/shared/structured-exchange";

const time = (data: StructuredGraphData) => {
  const start = performance.now();
  graphFigure(data, { isProposal: false });
  return performance.now() - start;
};
const valid = "shared/conformance/valid";
const corpus = [...readdirSync(valid).map((name) => path.join(valid, name)), "models/vehicle-architecture.json"].flatMap((file) => {
  const document = JSON.parse(readFileSync(file, "utf8"));
  return document.kind === "graph" ? [[path.basename(file), document.data as StructuredGraphData] as const] : [];
});
for (const [name, data] of corpus.sort((a, b) => b[1].edges.length - a[1].edges.length).slice(0, 3)) console.log(`${name}: ${data.nodes.length} elements, ${data.edges.length} relationships, ${time(data).toFixed(0)} ms`);
// Generated layered graphs: each element feeds the next two, kinds alternating
for (const count of [30, 60, 100]) {
  const data: StructuredGraphData = {
    nodes: Array.from({ length: count }, (_, index) => ({ id: `n${index}`, label: `Element ${index}`, kind: `k${index % 4}` })),
    edges: Array.from({ length: count - 2 }, (_, index) => [{ from: `n${index}`, to: `n${index + 1}`, kind: "a", label: `flow ${index}` }, { from: `n${index}`, to: `n${index + 2}`, kind: "b" }]).flat(),
  };
  console.log(`generated: ${count} elements, ${data.edges.length} relationships, ${time(data).toFixed(0)} ms`);
}
