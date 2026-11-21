/**
 * `reportsAccessDenied`: the sign a refusal of MXC's leaves in a command's output, without which
 * pi-outpost says nothing about the sandbox. The outputs are the programs' own.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reportsAccessDenied } from "../src/confinedBash.ts";

describe("reportsAccessDenied", () => {
  test("an access denied, as programs and Windows word it", () => {
    for (const output of [
      "Get-Content : Accès refusé", // PowerShell 5.1, French
      "    + CategoryInfo          : PermissionDenied: (C:\\other\\secret.txt:String) [Get-Content], UnauthorizedAccessException",
      "Get-Content: Access to the path 'C:\\other\\secret.txt' is denied.", // PowerShell 7 ("UnauthorizedAccess" in its category)
      "Access is denied.", // cmd.exe
      "Program 'node.exe' failed to run: Acc\uFFFDs refus\uFFFD", // a native program in the old code page
      "Zugriff verweigert",
      "Error: EACCES: permission denied, open 'C:\\x'", // Node
      "Error: EPERM: operation not permitted, scandir", // Node
      "PermissionError: [WinError 5] Accès refusé: 'C:\\\\x'", // Python
      "error: failed to open file: Access is denied. (os error 5)", // Rust, uv
      "fatal: could not open 'x': Permission denied", // git
      "java.nio.file.AccessDeniedException: C:\\x", // Java, Gradle
      "HRESULT: 0x80070005",
    ]) {
      assert.equal(reportsAccessDenied(output), true, output);
    }
  });

  test("other failures are not one", () => {
    for (const output of [
      "error: Failed to spawn: pytest\n  cause: program not found", // uv, a package not installed: the real session
      "Le terme « which » n'est pas reconnu comme nom d'applet de commande",
      "ModuleNotFoundError: No module named 'fastapi'",
      "npm ERR! code ENOENT",
      "error TS2304: Cannot find name 'x'.",
      "1 failed, 3 passed",
      "",
    ]) {
      assert.equal(reportsAccessDenied(output), false, output);
    }
  });
});
