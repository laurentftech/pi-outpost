/**
 * structured-exchange-arrangement: a real server on a workspace holding one graph with a viewpoint,
 * to drive the arrangement by hand in a browser. Prints the URL and the workspace; runs until killed.
 *
 *   npx tsx scripts/probes/structured-arrangement/serve.mts
 */
import { makeWorkspace, startServer } from "../../../server/test/harness.mjs";

const graph = {
  schema: "urn:structured-exchange:2",
  kind: "graph",
  viewpoints: [{ id: "power", label: "Power", concern: "Energy flow", elementKinds: ["source", "converter", "load"], relationshipKinds: ["power"] }],
  data: {
    nodes: [
      { id: "battery", label: "Battery", kind: "source" },
      { id: "inverter", label: "Inverter", kind: "converter" },
      { id: "motor", label: "Motor", kind: "load" },
      { id: "ecu", label: "ECU", kind: "controller" },
    ],
    edges: [
      { from: "battery", to: "inverter", kind: "power" },
      { from: "inverter", to: "motor", kind: "power" },
      { from: "ecu", to: "inverter", kind: "signal" },
    ],
  },
};
const root = await makeWorkspace({ "monkey.json": `${JSON.stringify(graph, null, 2)}\n` });
const server = await startServer(root, { sandbox: undefined });
console.log(`URL ${server.wsUrl().replace(/^ws/, "http").replace(/\/ws.*$/, "/")}`);
console.log(`ROOT ${root}`);
await new Promise(() => {});
