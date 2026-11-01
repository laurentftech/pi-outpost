import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ConfinementVerdict, SandboxGrantSet } from "@pi-outpost/shared";
import { ModelBar } from "./ModelBar";

const bar = (shellConfinement?: ConfinementVerdict, shellGrants?: SandboxGrantSet) =>
  render(
    <ModelBar
      model="m/x"
      models={[]}
      thinkingLevel="off"
      thinkingLevels={[]}
      modelSupportsReasoning={false}
      isStreaming={false}
      contextUsage={null}
      sessionUsage={{ turns: 0, unpriced: 0 } as never}
      analysisOpen={false}
      onToggleAnalysis={() => {}}
      isCompacting={false}
      onSetModel={() => {}}
      onSetThinking={() => {}}
      onCompact={() => {}}
      {...(shellConfinement ? { shellConfinement } : {})}
      {...(shellGrants ? { shellGrants } : {})}
    />,
  );

describe("the session's grants on the shell's lock", () => {
  const verified: ConfinementVerdict = { state: "verified", runner: "C:\\mxc\\wxc-exec.exe", checkedAt: "2026-11-01T10:00:00Z", refused: ["agent-directory", "beside-root"], notChecked: [] };

  // openlore: scenario=TheLockNamesItsGrants spec=sandbox-approved-grants
  it("TheLockNamesItsGrants: confined with one grant, listed beside the canary's refusals, the verdict unchanged", () => {
    bar(verified, { hosts: ["example.com"], directories: [] });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("🔒 shell confined · 1 grant");
    expect(lock.getAttribute("data-state")).toBe("verified");
    expect(lock.getAttribute("data-grants")).toBe("1");
    const title = lock.getAttribute("title")!;
    expect(title).toMatch(/A command could not:\n• read the agent directory/);
    expect(title).toMatch(/Granted by you for this session:\n• host example\.com$/);
  });

  it("counts every host and directory, and says how each directory is granted", () => {
    bar(verified, { hosts: ["example.com"], directories: [{ path: "/work/beside", access: "write" }, { path: "/work/notes", access: "read" }] });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("· 3 grants");
    expect(lock.getAttribute("title")).toMatch(/• read and write \/work\/beside\n• read \/work\/notes/);
  });

  // openlore: scenario=TheLockReturnsWhenGrantsEnd spec=sandbox-approved-grants
  it("TheLockReturnsWhenGrantsEnd: with none, the plain lock", () => {
    bar(verified, { hosts: [], directories: [] });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent(/^🔒 shell confined$/);
    expect(lock.getAttribute("title")).not.toMatch(/Granted/);
  });
});

describe("the agent shell's lock", () => {
  // openlore: scenario=AVerifiedRunnerEarnsTheLock spec=sandbox-runner-bash
  it("AVerifiedRunnerEarnsTheLock: closed, naming the runner, the time and each refusal", () => {
    bar({ state: "verified", runner: "/usr/bin/sandbox-exec", checkedAt: "2026-10-18T10:00:00Z", refused: ["agent-directory", "beside-root", "signal-process"], notChecked: [{ attempt: "server-environment", why: "no /proc" }] });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("🔒 shell confined");
    const title = lock.getAttribute("title")!;
    expect(title).toContain("/usr/bin/sandbox-exec");
    expect(title).toContain("read the agent directory");
    expect(title).toContain("signal another process");
    expect(title).toMatch(/Not checked:[\s\S]*no \/proc/);
  });

  // openlore: scenario=ALeakOpensTheLockAndSaysWhat spec=sandbox-runner-bash
  it("ALeakOpensTheLockAndSaysWhat: open, red, naming the agent directory", () => {
    bar({ state: "leaking", runner: "/opt/landstrip", checkedAt: "2026-10-18T10:00:00Z", reached: ["agent-directory"], refused: [] });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("🔓 shell not confined");
    expect(lock.className).toContain("red");
    expect(lock.getAttribute("title")).toMatch(/NOT confined[\s\S]*read the agent directory/);
  });

  // openlore: scenario=SecretsInAReadableEnvironmentAreNamed spec=sandbox-runner-bash
  it("SecretsInAReadableEnvironmentAreNamed: amber, partly confined, naming the variables and never a value", () => {
    bar({ state: "partial", runner: "/opt/landstrip", checkedAt: "2026-10-18T10:00:00Z", refused: ["agent-directory"], exposed: ["OPENAI_API_KEY"], notChecked: [] });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("🔐 shell partly confined");
    expect(lock.className).toContain("amber");
    expect(lock.getAttribute("title")).toMatch(/server's process environment, which holds OPENAI_API_KEY[\s\S]*agent directory/);
  });

  // openlore: scenario=AReadableEnvironmentWithoutSecretsKeepsTheLock spec=sandbox-runner-bash
  it("AReadableEnvironmentWithoutSecretsKeepsTheLock: closed, saying the environment is readable and holds no secret", () => {
    bar({ state: "verified", runner: "/opt/landstrip", checkedAt: "2026-10-18T10:00:00Z", refused: ["agent-directory"], notChecked: [], environmentReadable: true });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("🔒 shell confined");
    expect(lock.getAttribute("title")).toContain("readable, and holds no secret");
  });

  it("a canary that could not answer is a warning, never a lock", () => {
    bar({ state: "failed", runner: "/opt/r", checkedAt: "2026-10-18T10:00:00Z", reason: "the canary did not report" });
    const lock = screen.getByTestId("shell-confinement");
    expect(lock).toHaveTextContent("⚠ shell confinement unchecked");
    expect(lock).not.toHaveTextContent("🔒");
  });

  // openlore: scenario=NoRunnerNoLock spec=sandbox-runner-bash
  it("NoRunnerNoLock: no runner, no lock", () => {
    bar();
    expect(screen.queryByTestId("shell-confinement")).toBeNull();
  });
});
