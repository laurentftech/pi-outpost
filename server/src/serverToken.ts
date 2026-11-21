/**
 * The token a server uses when the operator configured none.
 *
 * Every connection presents a token, on the loopback too: a command confined by a sandbox
 * whose network reaches the host's loopback (MXC on Windows, `sandbox.hostLoopback`) must
 * not find a server that obeys anyone. So a server without `server.token` or
 * `PI_OUTPOST_TOKEN` makes one, once, and keeps it in the agent directory — the directory
 * every sandbox runner denies by name — where later starts find it again: the installed
 * web app and the tabs already open keep working across restarts.
 *
 * A configured token never touches the file. Deleting the file rotates the token.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/** The file, inside the agent directory. */
export const GENERATED_TOKEN_FILE = "outpost-token";

/**
 * The generated token: read from the agent directory, or made and kept there.
 *
 * Made complete under a private name and published by a hard link, which fails when the
 * name exists: two servers starting at once agree on whichever linked first, and neither
 * ever reads a half-written file.
 */
export function generatedToken(agentDir: string): string {
  const file = path.join(agentDir, GENERATED_TOKEN_FILE);
  const existing = readToken(file);
  if (existing !== undefined) return existing;
  mkdirSync(agentDir, { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  const draft = `${file}.${process.pid}.${randomBytes(6).toString("hex")}`;
  writeFileSync(draft, `${token}\n`, { flag: "wx", mode: 0o600 });
  try {
    linkSync(draft, file);
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const winner = readToken(file);
    if (winner === undefined) throw new Error(`${file} exists but holds no token: delete it and start again`);
    return winner;
  } finally {
    try {
      unlinkSync(draft);
    } catch {
      // already gone
    }
  }
}

/** The token a file holds; undefined when there is no file. An empty one is an error, not a token. */
function readToken(file: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const token = text.trim();
  if (token === "") throw new Error(`${file} holds no token: delete it and start again`);
  return token;
}
