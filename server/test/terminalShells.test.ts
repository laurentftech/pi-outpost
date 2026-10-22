import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { installedTerminalShells, findShellExecutable } from "../src/terminalShells.ts";
import { TerminalManager } from "../src/terminalManager.ts";

test("InstalledShellsOnly: missing executables and duplicate paths are excluded", () => {
  const shells = installedTerminalShells({ platform: "linux", defaultShell: { shell: "/bin/bash", args: ["-l"] }, resolve: name => name === "bash" || name === "/bin/bash" ? "/bin/bash" : undefined });
  assert.deepEqual(shells, [{ id: "default", label: "bash", shell: "/bin/bash", args: ["-l"] }]);
});

test("PowerShellByDefault: Windows starts PowerShell even with Git Bash installed", { skip: process.platform !== "win32" }, () => {
  const shell = new TerminalManager().getDefaultShell();
  assert.match(shell.shell, /powershell\.exe$/i);
  assert.deepEqual(shell.args, []);
});

test("ConfiguredShellWins: the configured shell and arguments stay first", () => {
  const shells = installedTerminalShells({ platform: "linux", configured: true, defaultShell: { shell: "/custom/sh", args: ["-i"] }, resolve: name => name.startsWith("/") ? name : undefined });
  assert.deepEqual(shells[0], { id: "configured", label: "Configured shell", shell: "/custom/sh", args: ["-i"] });
  assert.deepEqual(new TerminalManager().getDefaultShell({ shell: "/custom/sh", shellArgs: ["-i"] }), { shell: "/custom/sh", args: ["-i"] });
});

test("ConfinedChoicesStayConfined: Windows never offers Git Bash under a runner", () => {
  const options = { platform: "win32" as const, gitBash: "git-bash.exe", defaultShell: { shell: "powershell.exe", args: [] }, resolve: (name: string) => name };
  assert.ok(installedTerminalShells(options).some(shell => shell.id === "git-bash"));
  const confined = installedTerminalShells({ ...options, confined: true });
  assert.ok(!confined.some(shell => shell.id === "git-bash"));
  for (const shell of confined.filter(shell => ["powershell", "pwsh"].includes(shell.id))) assert.ok(shell.args.includes("$ProgressPreference='SilentlyContinue'"));
});

test("InstalledShellsOnly: directories and removed executables cannot be selected", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "terminal-shell-"));
  try {
    assert.equal(findShellExecutable(root), undefined);
    const executable = path.join(root, "shell");
    fs.writeFileSync(executable, "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(findShellExecutable(executable), executable);
    fs.unlinkSync(executable);
    assert.equal(findShellExecutable(executable), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
