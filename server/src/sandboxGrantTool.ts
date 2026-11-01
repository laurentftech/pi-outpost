/**
 * `run_with_grant`: the agent's confined shell, for one command that needs directories beyond the
 * sandbox — read or read-write — once the user has approved it.
 *
 * Hosts are not asked for here: a command that connects to a host the list does not name has the
 * user asked by its proxy while the connection waits (`confinedBash.ts`), and the agent has no part
 * in it. A file access cannot be held that way, so a directory is asked for by the agent, with the
 * command that needs it.
 *
 * The command and its grant travel together, so an approval is bound to the exact command it was
 * shown with: the next command, even the same one, runs without it unless the user granted it for
 * the session. What may never be granted is refused before anyone is asked (`sandboxGrants.ts`);
 * the asking, and the session's grants, are the broker's (`sandboxGrantBroker.ts`).
 */
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SandboxGrantOutcome } from "@pi-outpost/shared";
import { grantLogLine, type SandboxGrantBroker } from "./sandboxGrantBroker.ts";
import { checkGrantRequest, describeGrant, isEmptyGrant, type Grant, type GrantContext } from "./sandboxGrants.ts";

export const RUN_WITH_GRANT_TOOL = "run_with_grant";

const parameters = Type.Object({
  command: Type.String({ description: "The command to run, exactly as the shell tool would run it." }),
  reason: Type.String({ description: "Why the command needs more than the sandbox gives: shown to the user, as your words." }),
  directories: Type.Optional(
    Type.Array(
      Type.Object({
        path: Type.String({ description: "Absolute, or relative to the sandbox root." }),
        access: Type.Union([Type.Literal("read"), Type.Literal("write")], { description: "write is read-write." }),
      }),
      { description: "Directories beyond the sandbox the command must read, or write." },
    ),
  ),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds, as for the shell tool." })),
});

type Params = { command: string; reason: string; directories?: Array<{ path: string; access: "read" | "write" }>; timeout?: number };

/** Why nothing ran, for the model: refused, unanswered, or nobody there to ask. */
const NOT_RUN: Record<Exclude<SandboxGrantOutcome, "approved-once" | "approved-session">, string> = {
  refused: "The user refused the grant. The command did not run.",
  expired: "Nobody answered the grant request in time. The command did not run.",
  aborted: "The grant request was cancelled with the turn or the session. The command did not run.",
  unattended: "No one was connected to approve the grant. The command did not run.",
};

export interface RunWithGrantOptions {
  broker: SandboxGrantBroker;
  /** What the sandbox already gives, and the runner's limits: asked again at each call. */
  context: () => GrantContext;
  /** The shell tool's own name: `bash`, or `powershell`. */
  shellTool: string;
  /**
   * Runs `command` as the shell tool does — its output, truncation and exit status — with `grant`
   * added to the sandbox for that launch alone.
   */
  run(grant: Grant, params: { command: string; timeout?: number }, ...rest: ExecuteRest): ReturnType<ToolDefinition["execute"]>;
}

type ExecuteRest = Parameters<ToolDefinition["execute"]> extends [unknown, unknown, ...infer Rest] ? [toolCallId: string, ...Rest] : never;

export function createRunWithGrantToolDefinition(options: RunWithGrantOptions): ToolDefinition {
  return {
    name: RUN_WITH_GRANT_TOOL,
    label: "Run with grant",
    description:
      `Run one command of the confined shell with a grant: directories outside the sandbox it must read or write. ` +
      `The user approves or refuses every grant in the interface before anything runs, for this command only or for the rest of the session; ` +
      `without an answer nothing runs. Use it only after ${options.shellTool} was refused something the task needs, ` +
      `and ask for exactly that: a path outside the sandbox that was refused. The network is not asked for here: when a command ` +
      `connects to a host the sandbox does not list, the user is asked on the spot, and the command's output ends saying what they answered. ` +
      `No grant lets a command start a program outside the sandbox — ` +
      `opening the user's browser or another desktop application (Start-Process on a URL, start, explorer, open) is refused whatever is granted: ` +
      `tell the user to open it themselves. The agent directory, the configuration, .pi directories, the home directory itself, ` +
      `a drive's root, IP addresses and localhost are never granted.`,
    promptSnippet: "Run one command with directories beyond the sandbox, once the user approves",
    promptGuidelines: [
      `Use ${RUN_WITH_GRANT_TOOL} only when ${options.shellTool} was refused a path outside the sandbox that the task really needs; never to try what the sandbox refuses. For a host, just run the command: the user is asked when it connects.`,
      `Opening a page or an application on the user's desktop is never grantable: give the user the link instead.`,
      `Ask for the narrowest grant: the one directory, read rather than write when reading is enough — but every directory the command needs in one request.`,
      `Say in reason, in one sentence, what the command does with it. If the user refuses, do not retry that grant within the same request: tell the user what is blocked. A new request from the user is a new question — when it needs a grant, ask for it, even for a place refused before.`,
    ],
    parameters,
    async execute(toolCallId, raw, signal, onUpdate, ctx) {
      const params = raw as Params;
      const context = options.context();
      const check = await checkGrantRequest({ directories: params.directories }, context);
      if (!check.ok) {
        const targets = check.refusals.map((refusal) => refusal.target).join(", ");
        options.broker.log(grantLogLine("forbidden", targets, params.command, params.reason));
        throw new Error(
          `Not asked: ${check.refusals.map((refusal) => `${refusal.target} — ${refusal.why}`).join("; ")}. The command did not run.`,
        );
      }
      const { grant } = check;
      if (isEmptyGrant(grant)) {
        // Everything asked for the sandbox gives already: an ordinary command, nobody to ask.
        const result = await options.run(grant, { command: params.command, timeout: params.timeout }, toolCallId, signal, onUpdate, ctx);
        return withLead(result, "The sandbox already gives what was asked: ran without a grant.");
      }
      const outcome = await options.broker.ask({
        kind: "command",
        command: params.command,
        grant,
        reason: params.reason,
        overridesReadOnly: !context.allowWrite && grant.directories.some((directory) => directory.access === "write"),
        ...(signal ? { signal } : {}),
      });
      if (outcome !== "approved-once" && outcome !== "approved-session") throw new Error(NOT_RUN[outcome]);
      const result = await options.run(grant, { command: params.command, timeout: params.timeout }, toolCallId, signal, onUpdate, ctx);
      const scope = outcome === "approved-once" ? "for this command" : "for the rest of the session";
      return withLead(result, `Ran with the user's grant ${scope}: ${describeGrant(grant)}.`);
    },
  };
}

/** The tool result with a first line saying what it ran with. */
async function withLead(result: Awaited<ReturnType<ToolDefinition["execute"]>>, lead: string): ReturnType<ToolDefinition["execute"]> {
  return { ...result, content: [{ type: "text", text: lead }, ...result.content] };
}
