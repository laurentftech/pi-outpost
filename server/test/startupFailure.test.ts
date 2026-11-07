/**
 * What a server says when it cannot start, and whether it waits to be read.
 *
 * Both halves are decisions, and a decision is cheap to test everywhere and
 * expensive to test through its effect: the message is a function of the error and
 * the address, and holding the console is a function of the platform, the
 * environment and the parent. The keypress itself is the only impure part, and it is
 * driven here through a stream the test supplies rather than a terminal it does not
 * have.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  bindFailureMessage,
  holdConsoleIfOwned,
  ownsItsConsole,
  parentImageName,
  parseTasklistImageName,
  waitForAKey,
} from "../src/startupFailure.ts";

const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`listen ${code} 127.0.0.1:3141`), { code });

// openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"ThePortIsAlreadyTaken","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
describe("the line an operator reads", () => {
  test("an occupied port names the address refused and the flag that moves it", () => {
    const message = bindFailureMessage(errno("EADDRINUSE"), "127.0.0.1", 3141);
    assert.match(message, /127\.0\.0\.1:3141/);
    assert.match(message, /already in use/);
    assert.match(message, /--port/);
  });

  test("the address is the one that was refused, not a remembered default", () => {
    const message = bindFailureMessage(errno("EADDRINUSE"), "0.0.0.0", 8080);
    assert.match(message, /0\.0\.0\.0:8080/);
    assert.doesNotMatch(message, /3141/);
  });

  // openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"TheBindFailsForSomeOtherReason","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
  test("another reason still gets a sentence", () => {
    const denied = bindFailureMessage(errno("EACCES"), "127.0.0.1", 80);
    assert.match(denied, /127\.0\.0\.1:80/);
    assert.match(denied, /--port/);

    const absent = bindFailureMessage(errno("EADDRNOTAVAIL"), "10.1.2.3", 3141);
    assert.match(absent, /10\.1\.2\.3:3141/);
    assert.match(absent, /--host/);
  });

  test("a permission refused on a high port does not blame privilege", () => {
    // A reserved range or a security product refuses a high port with EACCES too, and
    // "below 1024" would send that operator to inspect a number that is already fine.
    const high = bindFailureMessage(errno("EACCES"), "127.0.0.1", 3141);
    assert.match(high, /127\.0\.0\.1:3141/);
    assert.doesNotMatch(high, /1024/);
    assert.match(bindFailureMessage(errno("EACCES"), "127.0.0.1", 80), /below 1024/);
  });

  test("a literal IPv6 host keeps its brackets, so the port is still a port", () => {
    assert.match(bindFailureMessage(errno("EADDRINUSE"), "::1", 3141), /\[::1\]:3141/);
    assert.match(bindFailureMessage(errno("EADDRNOTAVAIL"), "fe80::1", 8080), /\[fe80::1\]:8080/);
    // and an IPv4 host gains nothing it did not have
    assert.match(bindFailureMessage(errno("EADDRINUSE"), "127.0.0.1", 3141), /(?<!\[)127\.0\.0\.1:3141/);
  });

  test("an unknown reason carries the reason, and never a stack", () => {
    const error = errno("EPERM");
    const message = bindFailureMessage(error, "127.0.0.1", 3141);
    assert.match(message, /127\.0\.0\.1:3141/);
    assert.match(message, /listen EPERM/);
    assert.doesNotMatch(message, /\n\s+at /);
    assert.ok(!message.includes(String(error.stack)));
  });

  test("something thrown that is not an Error is still a sentence", () => {
    assert.match(bindFailureMessage("port went missing", "127.0.0.1", 3141), /port went missing/);
  });
});

// openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"TheMessageOutlivesTheWindow","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
describe("whether this console dies with this process", () => {
  test("a file manager above us on Windows owns the window", () => {
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "explorer.exe" }), true);
    // However tasklist spelled it.
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "Explorer.EXE" }), true);
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: " explorer.exe " }), true);
  });

  // openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"NobodyElseIsMadeToWait","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
  test("a shell borrows a console that outlives us", () => {
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "cmd.exe" }), false);
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "powershell.exe" }), false);
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "pwsh.exe" }), false);
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "WindowsTerminal.exe" }), false);
  });

  test("no answer is not a yes", () => {
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: undefined }), false);
    assert.equal(ownsItsConsole({ platform: "win32", env: {}, parent: "" }), false);
  });

  test("elsewhere the terminal outlives the process, so nothing is held", () => {
    assert.equal(ownsItsConsole({ platform: "darwin", env: {}, parent: "explorer.exe" }), false);
    assert.equal(ownsItsConsole({ platform: "linux", env: {}, parent: "explorer.exe" }), false);
  });

  test("a runner is never made to wait, whatever is above it", () => {
    assert.equal(ownsItsConsole({ platform: "win32", env: { CI: "true" }, parent: "explorer.exe" }), false);
    assert.equal(ownsItsConsole({ platform: "win32", env: { CI: "1" }, parent: "explorer.exe" }), false);
    // and CI=false is how some runners say "not one"
    assert.equal(ownsItsConsole({ platform: "win32", env: { CI: "false" }, parent: "explorer.exe" }), true);
  });
});

describe("who launched us", () => {
  test("one CSV row yields the image name", () => {
    assert.equal(parseTasklistImageName('"explorer.exe","4242","Console","1","54,321 K"\r\n'), "explorer.exe");
    assert.equal(parseTasklistImageName('"pwsh.exe","17","Console","1","9 K"'), "pwsh.exe");
  });

  test("tasklist's polite refusal is not a process name", () => {
    // It exits zero while saying this, so a parser trusting the status alone would
    // take "INFO:" for an image name.
    assert.equal(parseTasklistImageName("INFO: No tasks are running which match the specified criteria.\r\n"), undefined);
    assert.equal(parseTasklistImageName(""), undefined);
    assert.equal(parseTasklistImageName("\r\n\r\n"), undefined);
    assert.equal(parseTasklistImageName('"","4242"'), undefined);
  });

  test("the real probe answers rather than throwing, on every platform", () => {
    // On anything but Windows there is no question to answer; on Windows a hardened
    // machine may refuse the call. Neither may take the failure path down with it.
    assert.doesNotThrow(() => parentImageName());
    if (process.platform !== "win32") assert.equal(parentImageName(), undefined);
  });
});

describe("holding the window", () => {
  test("a stream that is not a terminal is not waited on", async () => {
    let resumed = false;
    await waitForAKey({
      isTTY: false,
      resume: () => (resumed = true),
      pause: () => {},
      once: () => {},
    });
    assert.equal(resumed, false, "nothing to hold, so nothing was held");
  });

  test("raw mode that cannot be set is skipped, not hung", async () => {
    await waitForAKey({
      isTTY: true,
      setRawMode: () => {
        throw new Error("no raw mode here");
      },
      resume: () => assert.fail("should not have started waiting"),
      pause: () => {},
      once: () => {},
    });
  });

  test("a key ends the wait and hands the terminal back", async () => {
    const raw: boolean[] = [];
    let paused = false;
    let resumed = false;
    await waitForAKey({
      isTTY: true,
      setRawMode: (mode) => raw.push(mode),
      resume: () => (resumed = true),
      // A key already waiting: the listener fires as soon as it is attached.
      pause: () => (paused = true),
      once: (_event, listener) => listener(),
    });
    assert.equal(resumed, true, "the stream was read before it was waited on");
    assert.deepEqual(raw, [true, false]);
    assert.equal(paused, true);
  });
});

// openlore: {"domain":"cli","requirement":"AFailureToStartIsSaidOutLoud","scenario":"TheMessageOutlivesTheWindow","specFile":"openspec/changes/say-why-the-server-could-not-start/specs/cli/spec.md"}
describe("holding the console for any pre-listen failure", () => {
  const heldStream = (calls: string[]): NonNullable<NonNullable<Parameters<typeof holdConsoleIfOwned>[0]>["stdin"]> => ({
    isTTY: true,
    setRawMode: (mode) => calls.push(`raw:${mode}`),
    resume: () => calls.push("resume"),
    pause: () => calls.push("pause"),
    once: (_event, listener) => {
      calls.push("wait");
      listener();
    },
  });

  test("a file-manager launch that fails before listening still holds the window", async () => {
    const calls: string[] = [];
    const errs: string[] = [];
    const realErr = console.error;
    console.error = (line: string) => void errs.push(line);
    try {
      await holdConsoleIfOwned({
        platform: "win32",
        env: {},
        probe: () => "explorer.exe",
        stdin: heldStream(calls),
      });
    } finally {
      console.error = realErr;
    }
    assert.deepEqual(errs, ["[pi] press any key to close this window"]);
    assert.deepEqual(calls, ["raw:true", "resume", "wait", "raw:false", "pause"]);
  });

  test("a shell launch is not held and is not told to press a key", async () => {
    const calls: string[] = [];
    const errs: string[] = [];
    const realErr = console.error;
    console.error = (line: string) => void errs.push(line);
    try {
      await holdConsoleIfOwned({
        platform: "win32",
        env: {},
        probe: () => "pwsh.exe",
        stdin: heldStream(calls),
      });
    } finally {
      console.error = realErr;
    }
    assert.deepEqual(errs, [], "nothing printed");
    assert.deepEqual(calls, [], "the stream was never touched");
  });

  test("a runner is never held, whatever launched it", async () => {
    const calls: string[] = [];
    await holdConsoleIfOwned({
      platform: "win32",
      env: { CI: "true" },
      probe: () => "explorer.exe",
      stdin: heldStream(calls),
    });
    assert.deepEqual(calls, []);
  });

  test("off Windows there is nothing to hold", async () => {
    const calls: string[] = [];
    await holdConsoleIfOwned({
      platform: "linux",
      env: {},
      probe: () => "explorer.exe",
      stdin: heldStream(calls),
    });
    assert.deepEqual(calls, []);
  });

  test("the probe is only consulted through this call, and its failure is not a yes", async () => {
    const calls: string[] = [];
    let probed = 0;
    await holdConsoleIfOwned({
      platform: "win32",
      env: {},
      probe: () => {
        probed += 1;
        return undefined; // a probe that could not answer
      },
      stdin: heldStream(calls),
    });
    assert.equal(probed, 1);
    assert.deepEqual(calls, []);
  });
});
