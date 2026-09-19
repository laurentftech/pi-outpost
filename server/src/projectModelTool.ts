/**
 * When `present_project_model` is worth its place in a request.
 *
 * Its schema costs some 1 600 characters in every request it is sent with, and most
 * conversations never go near a project's profiles and rules. So it is withheld, and
 * published when the conversation touches the project's model — this is the reading of
 * "touches". Like the extractors' test, a wrong guess costs one idle turn; a missed one
 * costs an agent writing rules without the check it is told to run, so the triggers lean
 * on what an agent doing that work cannot avoid doing: naming, reading or writing the files.
 *
 * Words such as "rule" or "profile" are deliberately not triggers. They are in half the
 * conversations of a project with a model, and would put the tool back in all of them.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH } from "@pi-outpost/shared/structured-exchange/profile";

export const PROJECT_MODEL_TOOL = "present_project_model";

/** The setup skill, however the agent reaches it: bundled, copied into a project, or a user's own. */
const SETUP_SKILL = /(?:^|[/\\])structured-exchange-project[/\\]SKILL\.md$/i;

/** A written file that declares itself a profile, a rules file or a registry. */
const MODEL_FORMAT = /"urn:structured-exchange-(?:profile|profile-registry|rules):\d+"/;

/** How the structured-exchange tools say the project's registry cannot be used. */
const UNUSABLE_REGISTRY = /structured-exchange (?:profile )?registry cannot be used/;

const posix = (value: string): string => value.split(path.sep).join("/").replace(/\\/g, "/");

/**
 * The files of the project's model, relative to the project: the registry, and the paths
 * it lists. Read tolerantly: a registry that is broken, missing or half-written still names
 * itself, and whatever paths can be read from it.
 */
export async function projectModelFiles(projectRoot: string): Promise<string[]> {
  const files = [STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH];
  try {
    const registry = JSON.parse(await readFile(path.join(projectRoot, STRUCTURED_EXCHANGE_PROFILE_REGISTRY_PATH), "utf8")) as {
      profiles?: unknown;
      rules?: unknown;
    };
    for (const list of [registry.profiles, registry.rules]) {
      if (!Array.isArray(list)) continue;
      for (const entry of list) if (typeof entry === "string" && entry !== "") files.push(posix(path.normalize(entry)));
    }
  } catch {
    // Nothing more to name than the registry itself.
  }
  return files;
}

/**
 * The user opening the setup skill themselves. The SDK expands `/skill:name` inside the
 * session, after the server has seen the prompt, so what is seen here is the command.
 */
const SETUP_SKILL_COMMAND = /(?:^|\s)\/skill:structured-exchange-project(?=$|\s)/;

/**
 * Whether a prompt names one of the model's files, as a path token rather than inside
 * another word — or opens the setup skill, which is the user saying the work is starting.
 */
export function promptNamesProjectModel(text: string, files: readonly string[]): boolean {
  if (SETUP_SKILL_COMMAND.test(text)) return true;
  const normalized = posix(text);
  return files.some((file) => {
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(file, from);
      if (at === -1) return false;
      const before = at === 0 ? "" : normalized[at - 1];
      const after = normalized[at + file.length] ?? "";
      if (/^$|[\s"'`<(/@]/.test(before) && /^$|[\s"'`>),;:!?.]/.test(after)) return true;
      from = at + 1;
    }
  });
}

/**
 * Whether a tool call reads or writes the project's model, or opens the skill that teaches
 * how to write it. A `path` is resolved against the project, which is the agent's working
 * directory; `roots` also names the project's real path, since an agent may pass either.
 */
export function toolCallTouchesProjectModel(args: unknown, roots: readonly string[], files: readonly string[]): boolean {
  if (args === null || typeof args !== "object") return false;
  const { path: target, content } = args as { path?: unknown; content?: unknown };
  if (typeof content === "string" && MODEL_FORMAT.test(content)) return true;
  if (typeof target !== "string" || target === "") return false;
  if (SETUP_SKILL.test(target)) return true;
  return roots.some((root) => {
    const relative = posix(path.relative(root, path.resolve(root, target)));
    return files.includes(relative);
  });
}

/** The tools that refuse a document when the project's registry cannot be used. */
const REGISTRY_BOUND_TOOLS: ReadonlySet<string> = new Set(["present_structure", "write_structure_figure", "write_structure_table"]);

/**
 * Whether a tool's result is a refusal because the project's registry cannot be used.
 *
 * Judged by the tool and its words, not by an error flag: the agent loop marks a result
 * as an error only when the tool throws, and these tools refuse by returning text.
 */
export function resultReportsUnusableRegistry(toolName: string, text: string): boolean {
  return REGISTRY_BOUND_TOOLS.has(toolName) && UNUSABLE_REGISTRY.test(text);
}
