import { createHmac } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { buildApp } from "../src/app.ts";
import type { PlanningServerConfig } from "../src/config.ts";
import { planningRoutes } from "../src/routes.ts";
import { PlanningStore } from "../src/store.ts";

export const SECRET = "test-bearer-secret";
export const KEY = "test-identity-key-0123456789abcdef01234567";

/** A token as Open WebUI mints it (utils/headers.py, `_mint_forward_user_jwt`). */
export function mintToken(sub: string, options: { key?: string; expiresIn?: number; iss?: string; alg?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = part({ alg: options.alg ?? "HS256", typ: "JWT" });
  const payload = part({ sub, email: `${sub}@example.test`, name: sub, role: "user", iss: options.iss ?? "open-webui", iat: now, exp: now + (options.expiresIn ?? 300) });
  const signature = createHmac("sha256", options.key ?? KEY).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export async function tempDir(t: TestContext): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "planning-server-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function testConfig(t: TestContext, overrides: Partial<PlanningServerConfig> = {}): Promise<PlanningServerConfig> {
  return {
    host: "127.0.0.1",
    port: 0,
    secret: SECRET,
    identity: "signed",
    identityKey: KEY,
    dataDir: await tempDir(t),
    maxPlanningBytes: 1_000_000,
    maxRevisions: 500,
    maxPlanningsPerUser: 200,
    ...overrides,
  };
}

export async function testApp(t: TestContext, overrides: Partial<PlanningServerConfig> = {}) {
  const config = await testConfig(t, overrides);
  const store = new PlanningStore(config);
  const app = buildApp(config, planningRoutes(store, config));
  t.after(() => app.close());
  /** Calls a tool as Open WebUI would, for `user`. */
  const call = (tool: string, body: unknown = {}, user = "alice", headers: Record<string, string> = {}) =>
    app.inject({
      method: "POST",
      url: `/${tool}`,
      headers: {
        authorization: `Bearer ${SECRET}`,
        ...(config.identity === "signed" ? { "x-openwebui-user-jwt": mintToken(user) } : { "x-openwebui-user-id": user }),
        ...headers,
      },
      payload: body as object,
    });
  return { app, config, store, call };
}

/** A small valid planning, with ids on every item. */
export function samplePlanning(title = "Programme X") {
  return {
    schema: "urn:structured-exchange:3",
    kind: "timeline",
    data: {
      title,
      time: { start: "2027-01-01", end: "2027-12-31", scale: "month" },
      rows: [
        { type: "separator", label: "System A" },
        {
          type: "task",
          id: "T1",
          label: "Study",
          items: [
            { type: "activity", id: "study", start: "2027-01-10", end: "2027-03-31", label: "Study" },
            { type: "milestone", id: "srr", date: "2027-04-15", kind: "SRR", label: "Requirements review" },
          ],
        },
        {
          type: "task",
          id: "T2",
          label: "Build",
          items: [{ type: "activity", id: "build", start: "2027-05-01", end: "2027-09-30", label: "Build" }],
        },
      ],
      dependencies: [{ from: "srr", to: "build" }],
    },
  };
}

/** Every file under `dir`, relative, sorted. */
export async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}
