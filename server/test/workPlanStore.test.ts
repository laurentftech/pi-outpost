/**
 * Where a session's Work Plan is kept, and what happens when that file cannot be read or
 * written (`workPlanStore.ts`). The plan's contract and the tool are `work-plan.test.ts`'s.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { applyWorkPlanMutation, copyWorkPlan, deleteWorkPlan, loadWorkPlan, sameSessionFile, workPlanPath } from "../src/workPlanStore.ts";

const create = { action: "create" as const, title: "Release", tasks: [{ title: "Tag it" }] };

describe("the Work Plan store", () => {
  let root: string;
  let sessions = 0;
  /** A session file path of its own for each test, in a directory that exists. */
  const session = () => path.join(root, `session-${++sessions}.jsonl`);

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-outpost-work-plan-store-"));
  });
  after(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  test("two absent session files are the same session; one absent and one named are not", () => {
    assert.equal(sameSessionFile(undefined, undefined), true);
    assert.equal(sameSessionFile(undefined, session()), false);
    assert.equal(sameSessionFile(session(), undefined), false);
  });

  test("a session file deleted from disk keeps its identity by its path", () => {
    // Neither exists, so neither resolves to a real path: they compare as written.
    const gone = session();
    assert.equal(sameSessionFile(gone, path.join(path.dirname(gone), ".", path.basename(gone))), true);
    assert.equal(sameSessionFile(gone, session()), false);
  });

  test("a session with no file yet has no plan, and cannot be given one", async () => {
    assert.equal(await loadWorkPlan(undefined), null);
    await assert.rejects(applyWorkPlanMutation(undefined, create), /^Error: The session has no persistent file yet$/);
  });

  test("reading the plan writes nothing", async () => {
    const file = session();
    assert.equal(await applyWorkPlanMutation(file, { action: "get" }), null);
    assert.equal(await fs.stat(workPlanPath(file)).catch(() => null), null);
  });

  test("a sidecar that is not JSON, or not a plan, is refused by name rather than read as no plan", async () => {
    const broken = session();
    await fs.writeFile(workPlanPath(broken), "{ not json");
    await assert.rejects(loadWorkPlan(broken), /^Error: Cannot load the Work Plan: /);

    const notAPlan = session();
    await fs.writeFile(workPlanPath(notAPlan), JSON.stringify({ version: 99, tasks: "none" }));
    await assert.rejects(loadWorkPlan(notAPlan), /^Error: Cannot load the Work Plan: /);
    // A mutation does not overwrite what it could not read.
    await assert.rejects(applyWorkPlanMutation(notAPlan, create), /Cannot load the Work Plan/);
    assert.equal(await fs.readFile(workPlanPath(notAPlan), "utf8"), JSON.stringify({ version: 99, tasks: "none" }));
  });

  test("deleting a plan that was never written is not an error", async () => {
    await deleteWorkPlan(session());
  });

  test("a sidecar that cannot be removed says so", async () => {
    const file = session();
    // A directory where the sidecar would be: unlinking it fails with something other than ENOENT.
    await fs.mkdir(workPlanPath(file));
    await assert.rejects(deleteWorkPlan(file), (error: NodeJS.ErrnoException) => error.code !== undefined && error.code !== "ENOENT");
  });

  test("a plan that cannot be written leaves no temporary file behind", async () => {
    const directory = path.join(root, "no-such-directory");
    const file = path.join(directory, "session.jsonl");
    await assert.rejects(applyWorkPlanMutation(file, create), (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    // Nothing was created where the session would have been, not even the directory.
    assert.equal(await fs.stat(directory).catch(() => null), null);
    assert.deepEqual((await fs.readdir(root)).filter((name) => name.endsWith(".tmp")), []);
  });

  test("a fork copies nothing from no session, to no session, or onto itself", async () => {
    const source = session();
    await applyWorkPlanMutation(source, create);
    const before = await fs.readFile(workPlanPath(source), "utf8");

    await copyWorkPlan(undefined, source);
    await copyWorkPlan(source, undefined);
    await copyWorkPlan(source, source);

    assert.equal(await fs.readFile(workPlanPath(source), "utf8"), before);
  });

  test("a fork of a session without a plan leaves the fork without one", async () => {
    const source = session();
    const fork = session();
    await applyWorkPlanMutation(fork, create);

    await copyWorkPlan(source, fork);

    assert.equal(await loadWorkPlan(fork), null);
    assert.equal(await fs.stat(workPlanPath(fork)).catch(() => null), null);
  });
});
