/**
 * File-scoped tool sandbox.
 *
 * SECURITY: wraps the built-in file tools (read/ls/grep/find, optionally
 * edit/write) so every `path` argument must resolve — symlinks included —
 * inside the sandbox root. Bash is excluded unless explicitly allowed in the
 * config, because a shell cannot be path-scoped.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { SandboxConfig } from "./config.ts";

/**
 * Resolve `target` following symlinks in its deepest existing ancestor, so a
 * link pointing outside the root cannot smuggle paths in (or out) of the
 * sandbox. Non-existent tails (e.g. a file about to be written) are kept as-is.
 */
export async function realResolve(target: string): Promise<string> {
  let existing = target;
  let tail = "";
  for (;;) {
    try {
      const real = await fs.realpath(existing);
      return tail ? path.join(real, tail) : real;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return target; // reached fs root, nothing exists
      tail = tail ? path.join(path.basename(existing), tail) : path.basename(existing);
      existing = parent;
    }
  }
}

export function isWithin(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function scopeToRoot(def: ToolDefinition, realRoot: string): ToolDefinition {
  return {
    ...def,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const target = (params as { path?: unknown }).path;
      if (typeof target === "string" && target !== "") {
        const resolved = await realResolve(path.resolve(realRoot, target));
        if (!isWithin(realRoot, resolved)) {
          throw new Error(`Access denied: "${target}" is outside the sandbox (${realRoot})`);
        }
      }
      return def.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
}

/**
 * Build the sandboxed replacement toolset. Use with `noTools: "builtin"` so
 * these are the only file tools the model sees.
 */
export async function createSandboxedTools(sandbox: SandboxConfig): Promise<ToolDefinition[]> {
  const realRoot = await fs.realpath(sandbox.root);
  const factories: Array<(cwd: string) => ToolDefinition> = [
    (cwd) => createReadToolDefinition(cwd) as ToolDefinition,
    (cwd) => createLsToolDefinition(cwd) as ToolDefinition,
    (cwd) => createGrepToolDefinition(cwd) as ToolDefinition,
    (cwd) => createFindToolDefinition(cwd) as ToolDefinition,
  ];
  if (sandbox.allowWrite) {
    factories.push(
      (cwd) => createEditToolDefinition(cwd) as ToolDefinition,
      (cwd) => createWriteToolDefinition(cwd) as ToolDefinition,
    );
  }
  const tools = factories.map((create) => scopeToRoot(create(realRoot), realRoot));
  if (sandbox.allowBash) {
    // Explicit opt-in: bash runs in the root but is NOT path-confined
    tools.push(createBashToolDefinition(realRoot) as ToolDefinition);
  }
  return tools;
}
