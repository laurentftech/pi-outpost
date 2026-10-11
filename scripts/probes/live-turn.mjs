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
const env = Object.fromEntries(Object.keys(process.env).filter((key) => /API_KEY|AUTH_TOKEN|_TOKEN$/.test(key) && key !== keep).map((key) => [key, undefined]));
// PI_OFFLINE keeps the catalog local; the request itself still goes out.
const server = await startServer(await makeWorkspace({ "notes.md": "# Notes\n" }), {}, { env });
const client = connect(server.wsUrl());
try {
  const hello = await client.waitFor("hello", 60_000);
  console.log("pi SDK", hello.piSdkVersion ?? "(not in hello)", "· model", hello.model);
  client.send({ type: "prompt", text: "Reply with the single word OK, nothing else." });
  await client.waitFor((m) => m.type === "agent_end" || m.type === "error", 120_000);
  const error = client.received.find((m) => m.type === "error");
  const text = client.received.filter((m) => m.type === "block_delta" && typeof m.delta === "string").map((m) => m.delta).join("");
  console.log(error ? `error: ${error.message}` : `answer: ${JSON.stringify(text.trim())}`);
  console.log("events:", [...new Set(client.received.map((m) => m.type))].join(","));
} finally {
  client.close();
  await server.stop();
}
