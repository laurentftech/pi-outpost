/**
 * One short real turn through the embedded runtime, with the developer's own key for
 * one provider (and no other): proves a pi SDK bump still talks to a real model.
 * Costs a few tokens — one turn, not a suite.
 *
 *   node scripts/probes/live-turn.mjs MISTRAL_API_KEY
 */
import { connect, makeWorkspace, startServer } from "../../server/test/harness.mjs";

const keep = process.argv[2] ?? "MISTRAL_API_KEY";
if (!process.env[keep]) throw new Error(`${keep} is not set`);
const env = Object.fromEntries(Object.keys(process.env).filter((key) => (key.includes("API_KEY") || key.includes("AUTH_TOKEN") || key.endsWith("_TOKEN")) && key !== keep).map((key) => [key, undefined]));
// PI_OFFLINE keeps the catalog local; the request itself still goes out.
const server = await startServer(await makeWorkspace({ "notes.md": "# Notes\n" }), {}, { env });
const client = connect(server.wsUrl());
try {
  const hello = await client.waitFor("hello", 60_000);
  console.log("pi SDK", hello.piSdkVersion ?? "(not in hello)", "· model", hello.model);
  client.send({ type: "prompt", text: "Reply with the single word OK, nothing else." });
  await client.waitFor((m) => m.type === "agent_end" || m.type === "error", 120_000);
  const error = client.received.find((m) => m.type === "error");
  console.log(error ? "request failed" : "response received");
  console.log("events:", [...new Set(client.received.map((m) => m.type))].join(","));
} finally {
  client.close();
  await server.stop();
}
