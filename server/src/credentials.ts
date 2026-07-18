/**
 * Model credentials and custom providers.
 *
 * Two files, two owners. `auth.json` belongs to the SDK's AuthStorage — it owns the
 * schema and the file lock that lets several pi processes share it, so we never write
 * it ourselves. `models.json` the SDK only *reads*: it exposes no writer, so we write
 * it, in its format, merging into the existing `providers` map rather than clobbering
 * a file the user may have hand-written.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { AuthStorage } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js";
import type { ProviderCompat } from "@pi-outpost/shared";

export class CredentialError extends Error {}

/** OpenAI-compatible endpoint as the UI and the CLI describe it. */
export interface ProviderDeclaration {
  provider: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  compat?: ProviderCompat;
}

/** A provider id has to survive as a JSON key and a config lookup — keep it boring. */
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Providers the SDK knows about, for `login` to check a name against. A typo would
 * otherwise store a credential nothing ever reads, and report success — leaving the
 * user with a server that still says it has no credentials and no clue why.
 */
export async function knownProviders(agentDir: string): Promise<string[]> {
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: path.join(agentDir, "models.json"),
    allowModelNetwork: false,
  });
  return [...new Set(modelRuntime.getProviders().map((p: { id: string }) => p.id))].sort();
}

export function validProviderId(provider: unknown): provider is string {
  return typeof provider === "string" && PROVIDER_ID.test(provider);
}

export function validBaseUrl(baseUrl: unknown): baseUrl is string {
  if (typeof baseUrl !== "string") return false;
  try {
    const url = new URL(baseUrl);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Store an API key for a provider the registry already knows, in `<agentDir>/auth.json`.
 *
 * `storage` matters: a running server must pass *its own* AuthStorage, the one its
 * ModelRegistry reads through. Writing with a fresh instance updates the file but
 * leaves the live registry looking at what it cached — the key lands on disk and the
 * agent still says it has none. The CLI, which has no server, gets the default.
 */
export async function storeApiKey(
  agentDir: string,
  provider: string,
  apiKey: string,
  modelRuntime?: { setRuntimeApiKey(provider: string, apiKey: string): Promise<void> },
): Promise<string> {
  if (!validProviderId(provider)) throw new CredentialError(`Invalid provider name: ${provider}`);
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) throw new CredentialError("An API key is required");
  const authPath = path.join(agentDir, "auth.json");
  await fs.mkdir(agentDir, { recursive: true }).catch(() => {});

  // Always persist to auth.json on disk so the key survives a restart.
  try {
    const storage = AuthStorage.create(authPath);
    await storage.modify(provider, async () => ({ type: "api_key", key: apiKey.trim() }));
  } catch (error) {
    throw new CredentialError(`Could not write ${authPath}: ${(error as Error).message}`);
  }

  // Also register with the live model runtime so the current session sees it.
  if (modelRuntime) {
    await modelRuntime.setRuntimeApiKey(provider, apiKey.trim());
  }

  return authPath;
}

/** The SDK's models.json shape — only the part we touch. */
interface ModelsFile {
  providers?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Persist an OpenAI-compatible endpoint to `<agentDir>/models.json`.
 *
 * The key lives in this file (that is where the SDK looks for a custom provider's
 * key), so the file is written with owner-only permissions — it holds a secret, even
 * though its name suggests plain configuration.
 */
export async function storeProvider(agentDir: string, declaration: ProviderDeclaration): Promise<string> {
  const { provider, baseUrl, apiKey, models } = declaration;
  if (!validProviderId(provider)) throw new CredentialError(`Invalid provider name: ${provider}`);
  if (!validBaseUrl(baseUrl)) throw new CredentialError("The base URL must be an http(s) URL");
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) throw new CredentialError("An API key is required");
  if (!Array.isArray(models) || models.length === 0 || models.some((id) => typeof id !== "string" || id.trim() === "")) {
    throw new CredentialError("At least one model id is required");
  }

  const modelsPath = path.join(agentDir, "models.json");
  await fs.mkdir(agentDir, { recursive: true }).catch(() => {});
  let file: ModelsFile = {};
  try {
    file = JSON.parse(await fs.readFile(modelsPath, "utf8")) as ModelsFile;
  } catch (error) {
    // A file that exists but does not parse is a file we must not overwrite: it is
    // the user's, and clobbering it would destroy providers we cannot even read.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CredentialError(`${modelsPath} exists but is not valid JSON — fix or move it first`);
    }
  }

  file.providers = {
    ...file.providers,
    [provider]: providerFileEntry(declaration),
  };
  try {
    await fs.writeFile(modelsPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    // `mode` only applies when writeFile *creates* the file. A models.json the user
    // hand-wrote under a 0644 umask would keep those permissions — and it now holds
    // their API key, readable by every local account. Narrow it either way.
    await fs.chmod(modelsPath, 0o600);
  } catch (error) {
    throw new CredentialError(`Could not write ${modelsPath}: ${(error as Error).message}`);
  }
  return modelsPath;
}

/**
 * What models.json stores: a bare `{ id }` per model, which the SDK's loader fills in
 * with its own defaults when it reads the file back.
 */
export function providerFileEntry(declaration: ProviderDeclaration) {
  const { baseUrl, apiKey, models, compat } = declaration;
  return {
    baseUrl,
    api: "openai-completions" as const,
    apiKey: apiKey.trim(),
    ...(compat && Object.keys(compat).length > 0 ? { compat } : {}),
    models: models.map((id) => ({ id: id.trim() })),
  };
}

/**
 * The same declaration for `registerProvider()`, which — unlike the file loader —
 * wants every field spelled out. The values below are the loader's own defaults
 * (model-registry.js), copied so a provider behaves identically whether it was just
 * declared or read back from models.json on the next start.
 */
export function providerConfig(declaration: ProviderDeclaration) {
  const entry = providerFileEntry(declaration);
  return {
    ...entry,
    models: declaration.models.map((id) => ({
      id: id.trim(),
      name: id.trim(),
      reasoning: false,
      input: ["text"] as ("text" | "image")[],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128000,
      maxTokens: 16384,
    })),
  };
}

/**
 * A corporate TLS-inspecting proxy re-signs certificates with an internal CA, and Node
 * then refuses the chain — surfacing as an opaque "fetch failed" with the real cause
 * buried in `cause`. Say what happened, and name the variable that fixes it.
 */
const TLS_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_UNTRUSTED",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export function tlsHint(error: unknown): string | undefined {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth++) {
    const { code, message } = (current ?? {}) as { code?: string; message?: string; cause?: unknown };
    if ((code && TLS_CODES.has(code)) || (message && [...TLS_CODES].some((tlsCode) => message.includes(tlsCode)))) {
      return `The model server's TLS certificate could not be verified${code ? ` (${code})` : ""}. Behind a TLS-inspecting proxy, trust your organisation's certificate authority: set NODE_EXTRA_CA_CERTS=/path/to/ca.pem before starting pi-outpost.`;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
