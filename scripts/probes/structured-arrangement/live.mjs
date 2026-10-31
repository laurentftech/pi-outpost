/**
 * structured-exchange-arrangement, task 9.1: a real agent writes the vehicle architecture's figure
 * for a Word report, the chief engineer adds an element, and the agent writes the figure again and
 * the report. What the figure tool said, the arrangement before and after, both figures and the
 * report are kept in OUT for a person to judge in Word desktop.
 *
 *   OUT=<dir> node --import tsx scripts/probes/structured-arrangement/live.mjs [provider/model]
 *
 * Credentials: only the chosen provider's entry of ~/.pi/agent/auth.json is read and copied into
 * the throwaway agent dir; nothing of ~/.pi/agent is written. An OAuth login is used only while its
 * access token has more than half an hour left, so the run never refreshes it: a refresh rotates
 * the refresh token, and the spent one left in the real file broke an OpenAI login on 2026-10-31.
 * When it is closer to expiry, use the login once in pi itself, which refreshes it in place.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connect, makeWorkspace, startServer } from "../../../server/test/harness.mjs";
import { vehicle } from "./vehicle.mts";

const [provider, id] = (process.argv[2] ?? "openai/gpt-5.6-luna").split("/");
const out = process.env.OUT;
if (!out) throw new Error("set OUT to a directory for the results");
await mkdir(out, { recursive: true });

const auth = JSON.parse(await readFile(path.join(os.homedir(), ".pi", "agent", "auth.json"), "utf8"));
const entry = auth[provider];
if (entry === undefined) throw new Error(`no credentials for ${provider}`);
if (entry.type === "oauth") {
  const expires = Number(entry.expires ?? entry.expiresAt ?? 0);
  const left = (expires > 1e12 ? expires : expires * 1000) - Date.now();
  if (!(left > 30 * 60_000)) {
    throw new Error(`the ${provider} login expires in ${Math.round(left / 60_000)} min: send one message with it in pi first, which refreshes it in place, then run this again`);
  }
}

const document = (data) => `${JSON.stringify({ schema: "urn:structured-exchange:1", kind: "graph", data }, null, 2)}\n`;
const root = await makeWorkspace({ "models/vehicle.json": document(vehicle) });
const repo = fileURLToPath(new URL("../../..", import.meta.url));
await copyFile(path.join(repo, "server", "test", "fixtures", "docx-template.dotx"), path.join(root, "modele.dotx"));
const agentDir = path.join(root, ".pi-agent");
await mkdir(agentDir, { recursive: true });
await writeFile(path.join(agentDir, "auth.json"), `${JSON.stringify({ [provider]: entry }, null, 2)}\n`, { mode: 0o600 });

const server = await startServer(root, { noSkills: false });
const client = connect(server.wsUrl());
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
const names = new Map();
const figureResults = [];
client.ws.on("message", (data) => {
  const m = JSON.parse(data.toString());
  if (m.type === "tool_start") {
    names.set(m.toolCallId, m.toolName);
    console.log(`[${elapsed()}] → ${m.toolName} ${JSON.stringify(m.args).slice(0, 200)}`);
  } else if (m.type === "tool_end") {
    const name = names.get(m.toolCallId);
    if (name === "write_structure_figure") figureResults.push(m.text);
    console.log(`[${elapsed()}] ← ${name}${m.isError ? " (error)" : ""}${name === "write_structure_figure" || m.isError ? `\n${m.text}` : ""}`);
  } else if (m.type === "assistant_end" && m.item?.errorMessage) {
    console.log(`[${elapsed()}] model error: ${m.item.errorMessage}`);
  } else if (m.type === "extension_ui_request") {
    console.log(`[${elapsed()}] extension asks: ${m.method} ${m.message ?? ""}`);
  }
});

async function turn(text) {
  const before = client.received.length;
  client.send({ type: "prompt", text });
  // This turn's end, not the last turn's, which is still among what was received
  const ended = () => client.received.slice(before).some((m) => m.type === "agent_end" || m.type === "error");
  for (const deadline = Date.now() + 300_000; !ended(); ) {
    if (Date.now() > deadline) {
      console.log(`[${elapsed()}] still running after 5 minutes: stopped`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const said = client.received.slice(before).filter((m) => m.type === "block_delta" && typeof m.delta === "string").map((m) => m.delta).join("");
  console.log(`\n=== reply\n${said.trim()}\n`);
}

const keep = async (name, from) => {
  const text = await readFile(path.join(root, from), "utf8").catch(() => undefined);
  if (text === undefined) console.log(`=== ${from} was not written`);
  else await writeFile(path.join(out, name), text);
  return text;
};

try {
  await client.waitFor("hello", 60_000);
  // Someone can watch the run in a browser: the URL, then a moment to open it
  console.log(`=== watch it at ${server.wsUrl().replace(/^ws/, "http").replace(/\/ws.*$/, "/")}`);
  if (process.env.WATCH) await new Promise((resolve) => setTimeout(resolve, Number(process.env.WATCH) * 1000));
  client.send({ type: "set_model", provider, id });
  await new Promise((resolve) => setTimeout(resolve, 1500));

  await turn(
    "Pour le rapport d'architecture, écris la figure de models/vehicle.json dans figures/vehicule-v1.svg, avec l'outil qui écrit les figures de documents structured-exchange.",
  );
  await keep("vehicule-v1.svg", "figures/vehicule-v1.svg");
  const first = await keep("arrangement-v1.json", "models/vehicle.arrangement.json");

  // The chief engineer's change: a heat pump on the cooling loop
  const revised = {
    nodes: [...vehicle.nodes, { id: "heatpump", label: "Pompe à chaleur", kind: "thermal" }],
    edges: [...vehicle.edges, { from: "cooling", to: "heatpump", kind: "thermal", label: "calories" }],
  };
  await writeFile(path.join(root, "models", "vehicle.json"), document(revised));

  await turn(
    "Le chief engineer a ajouté une pompe à chaleur dans models/vehicle.json. Écris la figure mise à jour dans figures/vehicule-v2.svg, " +
      "puis le rapport rapport.docx à partir du modèle modele.dotx : un titre, un paragraphe d'introduction, la figure v1 sous « Version initiale » et la figure v2 sous « Version révisée ».",
  );
  await keep("vehicule-v2.svg", "figures/vehicule-v2.svg");
  const second = await keep("arrangement-v2.json", "models/vehicle.arrangement.json");
  const report = await readFile(path.join(root, "rapport.docx")).catch(() => undefined);
  if (report === undefined) console.log("=== rapport.docx was not written");
  else await writeFile(path.join(out, "rapport.docx"), report);

  // What moved between the two arrangements: the answer to "nothing should"
  if (first !== undefined && second !== undefined) {
    const before = JSON.parse(first).views[""].elements;
    const after = JSON.parse(second).views[""].elements;
    const moved = Object.keys(before).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    const added = Object.keys(after).filter((key) => before[key] === undefined);
    console.log(`=== arrangement: ${moved.length} element(s) moved${moved.length ? ` (${moved.join(", ")})` : ""}, added ${added.join(", ") || "none"}`);
  }
  await writeFile(path.join(out, "figure-results.txt"), figureResults.join("\n\n---\n\n"));
  console.log(`=== turn total: ${elapsed()}`);
} finally {
  client.close();
  // Left running for whoever is watching, until the probe is stopped
  if (process.env.KEEP) {
    console.log("=== the server stays up for viewing; stop the probe to end it");
    await new Promise(() => {});
  }
  await server.stop();
}
