/** Types for fakePiPackages.mjs: a local npm registry serving a fake Pi extension. */
import type { TestContext } from "node:test";

/** npm, run the way it works on every platform (`npm.cmd` on Windows needs a shell). */
export function npm(args: string[], options?: Record<string, unknown>): Promise<{ stdout: string; stderr: string }>;
/** The fake extension's package name. */
export const NAME: string;
/** The tool name a given version of the fake extension registers. */
export function toolOf(version: string): string;

export interface FakeRegistryState {
  latest: string;
  published: Set<string>;
  withholdTarballs: boolean;
  requests: number;
}

export interface AgentDirAtOldVersion {
  scratch: string;
  reg: { url: string; state: FakeRegistryState };
  agentDir: string;
  cache: string;
  emptyGlobal: string;
}

/** An agent directory with 1.0.0 installed by npm itself, from a registry the test controls. */
export function agentDirAtOldVersion(t: Pick<TestContext, "after">, prefix: string, others?: Record<string, string>): Promise<AgentDirAtOldVersion>;
/** The version of the fake extension installed under `agentDir`. */
export function installedVersion(agentDir: string): Promise<string>;
