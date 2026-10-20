/**
 * A server on a workspace holding draw.io files, for driving the viewer's diagram
 * rendering in the running app:
 *
 *   node --import tsx/esm scripts/probes/drawio-server.mts
 *
 * then open http://127.0.0.1:4333/ (the standalone app: the bench's host page is a
 * widget, where the same view runs inside the host). `flow.drawio` and `lanes.drawio`
 * are draw.io's own templates (compressed pages); `two-pages.drawio` has two pages,
 * one with a remote image and font; `broken.drawio` is not a diagram. Prints the
 * workspace, so files can be changed underneath the app.
 */
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { makeWorkspace, startServer } from "../../server/test/harness.mjs";

const PORT = Number(process.env.DRAWIO_PORT ?? 4333);
const fixtures = path.resolve(import.meta.dirname, "../../server/test/fixtures/drawio");
const page = (name: string, cells: string) =>
  `<diagram id="${name}" name="${name}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram>`;
const box = (id: string, label: string, x: number, style = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;") =>
  `<mxCell id="${id}" value="${label}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="40" width="140" height="60" as="geometry"/></mxCell>`;
const twoPages = `<mxfile host="probe">${page("Context", box("a", "Client", 40) + box("b", "API gateway", 260) + `<mxCell id="e" edge="1" parent="1" source="a" target="b" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=block;"><mxGeometry relative="1" as="geometry"/></mxCell>`)}${page(
  "Remote things",
  box("img", "Remote image", 40, "shape=image;image=https://example.com/logo.png;html=1;") + box("font", "Remote font", 260, "text;html=1;fontFamily=Lobster;fontSource=https%3A%2F%2Ffonts.googleapis.com%2Fcss%3Ffamily%3DLobster;"),
)}</mxfile>`;

const root = await realpath(
  await makeWorkspace({
    "flow.drawio": await readFile(path.join(fixtures, "jgraph-flowchart.drawio"), "utf8"),
    "lanes.drawio": await readFile(path.join(fixtures, "jgraph-swimlanes.drawio"), "utf8"),
    "two-pages.drawio": twoPages,
    "broken.drawio": "<html><body>not a diagram</body></html>",
  }),
);

const env: Record<string, string | undefined> = {};
for (const name of Object.keys(process.env)) if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(name)) env[name] = undefined;
env.ANTHROPIC_API_KEY = "sk-ant-not-a-real-key";

await startServer(root, { server: { port: PORT }, branding: { title: "draw.io probe" }, sandbox: { root, allowWrite: true, allowBash: false }, updateCheck: false }, { env });
console.log(`workspace ${root}`);
console.log(`open http://127.0.0.1:${PORT}/`);
