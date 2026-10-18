/** Small injectable seam for the terminal provider-account commands. */
export interface CliAccountProvider {
  id: string;
  auth: { oauth?: unknown; apiKey?: { login?: unknown } };
}

export interface CliAccountRuntime {
  getProviders(): readonly CliAccountProvider[];
  login(providerId: string, method: "oauth" | "api_key", options: {
    signal: AbortSignal;
    notify: (event: { type: string; [key: string]: unknown }) => void;
    prompt: (prompt: { type: string; message: string; options?: Array<{ id: string; label: string; description?: string }>; signal?: AbortSignal }) => Promise<string>;
  }, context?: { getDeviceId?: () => Promise<string> | string }): Promise<unknown>;
  logout(providerId: string, options: { signal: AbortSignal }): Promise<unknown>;
}

export async function runCliProviderLogin(
  runtime: CliAccountRuntime,
  providerId: string,
  options: {
    signal: AbortSignal;
    notify: (event: { type: string; [key: string]: unknown }) => void;
    prompt: (prompt: { type: string; message: string; options?: Array<{ id: string; label: string; description?: string }>; signal?: AbortSignal }) => Promise<string>;
    getDeviceId?: () => Promise<string> | string;
  },
): Promise<boolean> {
  const provider = runtime.getProviders().find((candidate) => candidate.id === providerId);
  const method = provider?.auth.oauth ? "oauth" : provider?.auth.apiKey?.login ? "api_key" : undefined;
  if (!method) return false;
  const { getDeviceId, ...loginOptions } = options;
  await runtime.login(providerId, method, loginOptions, getDeviceId ? { getDeviceId } : undefined);
  return true;
}

export async function runCliProviderLogout(
  runtime: CliAccountRuntime,
  providerId: string,
  signal: AbortSignal = AbortSignal.timeout(30_000),
): Promise<void> {
  if (!runtime.getProviders().some((provider) => provider.id === providerId)) {
    throw new Error(`unknown provider "${providerId}"`);
  }
  await runtime.logout(providerId, { signal });
}
