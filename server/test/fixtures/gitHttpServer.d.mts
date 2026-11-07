/** Types for gitHttpServer.mjs: a local HTTPS git server with Basic authentication. */

export const GIT_TEST_CA: string;
/** A throwaway git config file trusting the test CA. */
export function isolatedGitConfig(extra?: string): string;
/** The environment git needs to trust the test server and nothing else. */
export function gitTrustEnv(): Record<string, string>;
/** A bare repository under `root` holding `files`, ready to clone. */
export function makeBareRepository(root: string, name: string, files?: Record<string, string>): string;

export interface GitRequest {
  method: string | undefined;
  path: string;
  authorized: boolean;
  user: string | undefined;
  hadCredentials: boolean;
}

export interface GitHttpServer {
  base: string;
  host: string;
  requests: GitRequest[];
  close(): Promise<void>;
}

export interface GitCredentials {
  username: string;
  password: string;
}

/** `credentials`, or a function returning them, so a test can change the accepted secret while the server runs. */
export function startGitHttpServer(options: { root: string; credentials: GitCredentials | (() => GitCredentials) }): Promise<GitHttpServer>;
