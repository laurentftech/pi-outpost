/**
 * How the shell's confinement is worded and shown (`confinementStatus.ts`): the refusal of an
 * `"auto"` shell for each verdict, what the interface is told, the nudge for an unconfined
 * shell, and which policy a terminal's runner takes. The canary itself is `confinementCanary.test.ts`'s.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import type { ConfinementVerdict } from "@pi-outpost/shared";
import type { SandboxConfig } from "../src/config.ts";
import {
  autoShown,
  autoUnavailableRefusal,
  autoVerdictRefusal,
  buildTerminalConfinement,
  confineSuggestion,
  shellVerdict,
  UNCONFINED_ESCAPE,
  unconfinedShellVerdict,
} from "../src/confinementStatus.ts";

const at = "2026-01-01T00:00:00.000Z";

describe("autoVerdictRefusal", () => {
  test("each verdict short of verified refuses, naming the runner and the way back to an unconfined shell", () => {
    const cases: Array<[ConfinementVerdict, RegExp]> = [
      [{ state: "checking", runner: "/opt/mxc/lxc-exec" }, /^The agent's shell is unavailable: lxc-exec cannot confine it on this machine — its confinement has not been checked yet\. /],
      [{ state: "failed", runner: "/usr/bin/sandbox-exec", checkedAt: at, reason: "the runner did not start" }, /: sandbox-exec cannot confine it on this machine — the runner did not start\. /],
      [
        { state: "leaking", runner: "/r/landstrip", checkedAt: at, reached: ["beside-root", "unlisted-host", "some-new-attempt" as never], refused: [] },
        /— its confinement check got through — a command could read a file beside the root, reach a host not in sandbox\.allowedHosts, some-new-attempt\. /,
      ],
      [
        { state: "partial", runner: "/r/landstrip", checkedAt: at, refused: [], exposed: ["OPENAI_API_KEY", "GH_TOKEN"], notChecked: [] },
        /which holds OPENAI_API_KEY, GH_TOKEN: move these out of the server's environment\. /,
      ],
      [{ state: "unconfined" }, /^The agent's shell is unavailable: cannot confine it on this machine — it is not a confined shell\. /],
    ];
    for (const [verdict, expected] of cases) {
      const refusal = autoVerdictRefusal(verdict);
      assert.match(refusal!, expected, verdict.state);
      assert.ok(refusal!.endsWith(UNCONFINED_ESCAPE), `${verdict.state} names the escape`);
    }
  });

  test("a verified verdict refuses nothing", () => {
    assert.equal(autoVerdictRefusal({ state: "verified", runner: "/r", checkedAt: at, refused: [], notChecked: [] }), undefined);
  });

  test("a platform with no runner at all says why, and the way back", () => {
    assert.equal(autoUnavailableRefusal("no runner for freebsd"), `The agent's shell is unavailable: nothing can confine it on this machine — no runner for freebsd. No command runs unconfined. ${UNCONFINED_ESCAPE}`);
  });
});

describe("autoShown", () => {
  test("a verified or still-checked verdict is shown as the canary gave it", () => {
    const checking: ConfinementVerdict = { state: "checking", runner: "/r" };
    const verified: ConfinementVerdict = { state: "verified", runner: "/r", checkedAt: at, refused: ["agent-directory"], notChecked: [] };
    assert.equal(autoShown(checking), checking);
    assert.equal(autoShown(verified), verified);
  });

  test("anything else is shown as a shell that is unavailable, with the refusal its commands meet", () => {
    const failed: ConfinementVerdict = { state: "failed", runner: "/r/landstrip", checkedAt: at, reason: "no user namespaces" };
    assert.deepEqual(autoShown(failed), { state: "unavailable", runner: "/r/landstrip", reason: autoVerdictRefusal(failed) });
    const unconfined = autoShown({ state: "unconfined" });
    assert.equal(unconfined.state, "unavailable");
    assert.equal(unconfined.runner, "", "no runner to name");
    assert.match((unconfined as { reason: string }).reason, /it is not a confined shell/);
  });
});

describe("unconfinedShellVerdict and the nudge", () => {
  test("a platform with no runner: unconfined, with the reason, and no nudge", async () => {
    let checked = false;
    const verdict = await unconfinedShellVerdict({ reason: "no runner for freebsd" }, async () => {
      checked = true;
      return { ok: true };
    });
    assert.deepEqual(verdict, { state: "unconfined", reason: "no runner for freebsd" });
    assert.equal(checked, false, "nothing to check");
    assert.equal(confineSuggestion(verdict), undefined);
  });

  test("a runner that passes its self-check is offered; one that fails says why", async () => {
    const candidate = { runner: "/usr/bin/sandbox-exec", label: "Seatbelt" };
    const passes = await unconfinedShellVerdict(candidate, async (runner) => {
      assert.equal(runner, candidate.runner);
      return { ok: true };
    });
    assert.deepEqual(passes, { state: "unconfined", available: candidate });
    assert.match(confineSuggestion(passes)!, /^the agent's shell runs unconfined, and Seatbelt can confine it on this machine: /);

    const fails = await unconfinedShellVerdict(candidate, async () => ({ ok: false, reason: "sandbox-exec is missing" }));
    assert.deepEqual(fails, { state: "unconfined", reason: "sandbox-exec is missing" });
    assert.equal(confineSuggestion(fails), undefined);
  });

  test("only an unconfined verdict nudges", () => {
    assert.equal(confineSuggestion(undefined), undefined);
    assert.equal(confineSuggestion({ state: "checking", runner: "/r" }), undefined);
  });
});

describe("shellVerdict", () => {
  test("no shell, or an extension's shell, has no verdict of pi-outpost's", async () => {
    assert.equal(await shellVerdict(undefined, {}), undefined);
    assert.equal(await shellVerdict({ allowWrite: true, allowBash: false } as SandboxConfig, {}), undefined);
    assert.equal(await shellVerdict({ allowWrite: true, allowBash: true, bashFrom: "some-extension" } as SandboxConfig, {}), undefined);
  });

  test("an auto shell on a platform with no runner is unavailable, and says why", async () => {
    const sandbox = { allowWrite: true, allowBash: true, autoRunner: { unavailable: "no runner for freebsd" } } as SandboxConfig;
    assert.deepEqual(await shellVerdict(sandbox, {}), { state: "unavailable", runner: "", reason: autoUnavailableRefusal("no runner for freebsd") });
  });

  test("a shell with no runner is unconfined, offered this machine's runner or told why not", async () => {
    const verdict = await shellVerdict({ allowWrite: true, allowBash: true } as SandboxConfig, {});
    assert.equal(verdict?.state, "unconfined");
    // Whichever this machine gives: one of the two, never both.
    const { available, reason } = verdict as { available?: unknown; reason?: string };
    assert.notEqual(available === undefined, reason === undefined);
  });
});

describe("buildTerminalConfinement", () => {
  // Paths inside a directory of this test's own, never fixed names in the shared temporary directory.
  const base = mkdtempSync(path.join(tmpdir(), "terminal-confinement-"));
  after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "root");
  const terminal = { tmp: path.join(base, "tmp"), shell: "/bin/sh", shellArgs: [], cwd: root, env: { PATH: "/usr/bin:/bin" } };

  test("each runner takes its own kind of policy", () => {
    const kinds = [
      ["/usr/bin/sandbox-exec", "seatbelt"],
      ["/opt/mxc/lxc-exec", "mxc"],
      ["C:\\mxc\\wxc-exec.exe", "mxc"],
      ["/usr/local/bin/landstrip", "landstrip"],
    ] as const;
    for (const [runner, kind] of kinds) {
      const confinement = buildTerminalConfinement({ runner, root, allowWrite: true });
      assert.equal(confinement.kind, kind, runner);
      assert.equal(confinement.runner, runner);
      assert.equal(confinement.root, root);
      assert.equal(typeof confinement.policy, "function");
    }
  });

  test("a landstrip terminal writes its writable zone and its own temporary directory, and never reads the agent directory or the configuration", () => {
    const agentDir = path.join(base, "agent");
    const configFile = path.join(base, "config.json");
    const writableRoot = path.join(root, "work");
    const policy = buildTerminalConfinement({ runner: "/usr/local/bin/landstrip", root, writableRoot, allowWrite: true, agentDir, configFile }).policy(terminal);
    assert.ok("filesystem" in policy);
    // On Windows landstrip's policy spells paths with forward slashes.
    const spelled = (p: string) => (process.platform === "win32" ? p.replaceAll("\\", "/") : p);
    const { allowRead, allowWrite, denyRead } = (policy as { filesystem: { allowRead: string[]; allowWrite: string[]; denyRead: string[] } }).filesystem;
    assert.ok(allowWrite.includes(spelled(writableRoot)), "the writable zone");
    assert.ok(!allowWrite.includes(spelled(root)), "not the whole root");
    assert.ok(allowWrite.includes(spelled(terminal.tmp)), "its temporary directory");
    assert.ok(allowRead.includes(spelled(root)));
    assert.ok(denyRead.includes(spelled(agentDir)));
    assert.ok(denyRead.includes(spelled(configFile)));
  });

  test("read-only, a landstrip terminal writes nothing but its temporary directory", () => {
    const policy = buildTerminalConfinement({ runner: "/usr/local/bin/landstrip", root, allowWrite: false }).policy(terminal);
    const spelled = (p: string) => (process.platform === "win32" ? p.replaceAll("\\", "/") : p);
    const { allowWrite } = (policy as { filesystem: { allowWrite: string[] } }).filesystem;
    assert.ok(!allowWrite.includes(spelled(root)));
    assert.ok(allowWrite.includes(spelled(terminal.tmp)));
  });
});
