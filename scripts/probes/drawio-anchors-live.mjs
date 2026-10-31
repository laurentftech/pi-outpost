/**
 * drawio-wire-anchors, task 4.2: one real turn in which an agent draws a diagram with several
 * flows between the same boxes, to see whether drawio_check raises the anchor warnings and
 * whether the agent moves the points as proposed. Uses the developer's own oauth credentials
 * (auth.json copied into the throwaway agent dir, nothing else of ~/.pi/agent), one prompt.
 *
 *   node scripts/probes/drawio-anchors-live.mjs [provider/model] [prompt]   (default openai/gpt-5.6-luna, the flow diagram)
 *
 * The prompt names its file; the probe checks whatever .drawio files the turn left behind,
 * itself, after the turn: the agent's last check is its account, not the outcome.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { connect, makeWorkspace, startServer } from "../../server/test/harness.mjs";
import { checkDrawio, readDrawio } from "../../server/src/drawio.ts";
import { pageGeometry, routeWire } from "../../server/src/drawioRoutes.ts";

const [provider, id] = (process.argv[2] ?? "openai/gpt-5.6-luna").split("/");
const root = await makeWorkspace({ "notes.md": "# Notes\n" });
const agentDir = path.join(root, ".pi-agent");
await mkdir(agentDir, { recursive: true });
const realAuth = path.join(os.homedir(), ".pi", "agent", "auth.json");
await copyFile(realAuth, path.join(agentDir, "auth.json"));
const authBefore = await readFile(realAuth, "utf8");
const server = await startServer(root, { noSkills: false });
const client = connect(server.wsUrl());
// Each tool as it happens: a turn that stalls shows where, instead of nothing until the end
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;
const names = new Map();
client.ws.on("message", (data) => {
  const m = JSON.parse(data.toString());
  if (m.type === "tool_start") {
    names.set(m.toolCallId, m.toolName);
    console.log(`[${elapsed()}] → ${m.toolName} ${JSON.stringify(m.args).slice(0, 160)}`);
  } else if (m.type === "tool_end") {
    const name = names.get(m.toolCallId);
    console.log(`[${elapsed()}] ← ${name}${m.isError ? " (error)" : ""}${name === "drawio_check" || m.isError ? `\n${m.text}` : ""}`);
  } else if (m.type === "assistant_end" && m.item?.errorMessage) {
    // A provider failure ends the turn quietly: an empty reply in two seconds, otherwise
    console.log(`[${elapsed()}] model error: ${m.item.errorMessage}`);
  } else if (m.type === "agent_end" || m.type === "error" || m.type === "extension_ui_request") {
    console.log(`[${elapsed()}] ${m.type} ${m.message ?? m.method ?? ""}`);
  }
});
try {
  await client.waitFor("hello", 60_000);
  client.send({ type: "set_model", provider, id });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  client.send({
    type: "prompt",
    text:
      process.argv[3] ??
      "Dessine dans diagrams/flux.drawio un schéma de flux : un Capteur envoie « mesures » et « alarmes » au Contrôleur ; " +
        "le Contrôleur envoie « commandes » à l'Actionneur et « état » au Tableau de bord ; l'Actionneur renvoie « position » au Contrôleur. " +
        "Place le Contrôleur au centre, les autres autour.",
  });
  // Four minutes, then say where it stood rather than wait on
  await client.waitFor((m) => m.type === "agent_end" || m.type === "error", 240_000).catch(() => console.log(`[${elapsed()}] still running after 4 minutes: stopped`));
  const said = client.received.filter((m) => m.type === "block_delta" && typeof m.delta === "string").map((m) => m.delta).join("");
  console.log(`\n=== reply\n${said.trim()}`);
  const checks = client.received.filter((m) => m.type === "tool_start" && m.toolName === "drawio_check").length;
  const edits = client.received.filter((m) => m.type === "tool_start" && (m.toolName === "edit" || m.toolName === "write")).length;
  console.log(`\n=== turn: ${elapsed()}, ${checks} drawio_check, ${edits} write/edit`);
  const found = (await readdir(root, { recursive: true })).filter((name) => name.endsWith(".drawio") && !name.includes(".pi-agent"));
  if (found.length === 0) console.log("=== no .drawio file written");
  for (const name of found) {
    const xml = await readFile(path.join(root, name), "utf8");
    // Kept beside the run's log: the workspace goes with the server
    if (process.env.OUT) await writeFile(path.join(process.env.OUT, path.basename(name)), xml);
    let routed = 0;
    let unrouted = 0;
    for (const page of readDrawio(xml)) {
      const geometry = pageGeometry(page);
      for (const cell of page.cells.filter((c) => c.edge)) routeWire(cell, geometry) ? routed++ : unrouted++;
    }
    const issues = checkDrawio(xml).issues;
    console.log(`=== final ${name}: ${routed} wires routed, ${unrouted} unrouted, ${issues.length} issue(s)`);
    for (const issue of issues) console.log(`  ${issue.severity}: ${issue.message.slice(0, 220)}`);
  }
} finally {
  client.close();
  // An OAuth refresh during the run rotates the refresh token: the new one is in the copy, and
  // the one left in the real file is spent. Without this, a run that refreshed broke the
  // developer's own login (openai, invalid_grant, 2026-10-31). The refreshed entries go back,
  // unless the real file changed meanwhile.
  // Read before the server stops: stopping it removes the workspace, the copy with it
  try {
    const copy = JSON.parse(await readFile(path.join(agentDir, "auth.json"), "utf8"));
    const before = JSON.parse(authBefore);
    if ((await readFile(realAuth, "utf8")) === authBefore) {
      const changed = Object.keys(copy).filter((provider) => JSON.stringify(copy[provider]) !== JSON.stringify(before[provider]));
      if (changed.length > 0) {
        await writeFile(realAuth, `${JSON.stringify({ ...before, ...Object.fromEntries(changed.map((provider) => [provider, copy[provider]])) }, null, 2)}\n`, { mode: 0o600 });
        console.log(`=== refreshed credentials written back for: ${changed.join(", ")}`);
      }
    } else {
      console.log("=== the real auth.json changed during the run: refreshed credentials NOT written back");
    }
  } catch (error) {
    console.log(`=== could not write refreshed credentials back: ${error.message}`);
  }
  await server.stop();
  await rm(agentDir, { recursive: true, force: true });
}
