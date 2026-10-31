/**
 * drawio_check sent in the same message as an edit of its file reports on the edited file
 * (drawio-diagrams: ACheckWaitsForAWriteInFlight). The real server and agent, driven by the
 * scripted provider: the runtime prepares both calls, then runs them together, which is where
 * a live Codestral run got "no defect" for a file its edit was rewriting.
 */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "./harness.mjs";

const PROVIDER = fileURLToPath(new URL("./fixtures/scripted-calls-provider.mjs", import.meta.url));
const MODEL = { provider: "scripted-calls-test", id: "scripted-calls-test" };

// A connector fixed on the far sides of its boxes runs through both; the edit puts it on the
// facing sides. The padding makes the edit long enough that a check run beside it, unwaited,
// reads the file before the edit lands.
const BROKEN = "edgeStyle=none;html=1;exitX=0;exitY=0.5;entryX=1;entryY=0.5;";
const FIXED = "edgeStyle=none;html=1;exitX=1;exitY=0.5;entryX=0;entryY=0.5;";
const padding = `<!-- ${"padding ".repeat(400_000)} -->`;
const diagram = (style) =>
  `<mxfile><diagram name="P"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
  `<mxCell id="a" value="A" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>` +
  `<mxCell id="b" value="B" style="rounded=0;html=1;" vertex="1" parent="1"><mxGeometry x="300" y="40" width="120" height="60" as="geometry"/></mxCell>` +
  `<mxCell id="w" value="" style="${style}" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>` +
  `</root></mxGraphModel></diagram></mxfile>${padding}\n`;

// openlore: scenario=ACheckWaitsForAWriteInFlight spec=drawio-diagrams
test("ACheckWaitsForAWriteInFlight: an edit and a check in one message, the check reports on the edited file", async (t) => {
  // Not resolved: on macOS the temporary directory is under /var, a link to /private/var, and the
  // edit and the check can name the file through either — the case that hid the first version
  const project = await makeWorkspace();
  await writeFile(path.join(project, "flow.drawio"), diagram(BROKEN));
  const log = path.join(project, ".calls.jsonl");
  const script = path.join(project, ".calls.json");
  await writeFile(
    script,
    JSON.stringify([
      { name: "tool_search", arguments: { query: "drawio_check" } },
      {
        calls: [
          { name: "edit", arguments: { path: "flow.drawio", edits: [{ oldText: BROKEN, newText: FIXED }] } },
          { name: "drawio_check", arguments: { path: "flow.drawio" } },
        ],
      },
    ]),
  );
  const server = await startServer(project, { extensionPaths: [PROVIDER], allowedModels: [MODEL] }, { env: { SCRIPTED_LOG: log, SCRIPTED_CALLS_FILE: script } });
  t.after(() => server.stop());
  const client = connect(server.wsUrl());
  t.after(() => client.close());
  await client.waitFor("hello", 30_000);
  client.send({ type: "set_model", ...MODEL });
  await client.waitFor("model_changed");
  client.send({ type: "prompt", text: "go" });
  await client.waitFor((message) => message.type === "agent_end", 60_000);

  const results = (await readFile(log, "utf8")).trim().split(/\r?\n/).map((line) => JSON.parse(line));
  const edit = results.find((result) => result.name === "edit");
  const check = results.find((result) => result.name === "drawio_check");
  assert.equal(edit?.isError, false, `the edit applied: ${edit?.text}`);
  assert.equal(check?.isError, false, `the check ran: ${check?.text}`);
  assert.match(check.text, /valid draw\.io diagram with no defect/, `the check saw the edited file: ${check.text}`);
  assert.ok((await readFile(path.join(project, "flow.drawio"), "utf8")).includes(FIXED));
});
