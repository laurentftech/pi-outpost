/**
 * Browser-side shared-token handling (Jupyter-style): the token arrives once
 * as ?token=… in the URL, is persisted to localStorage, and is immediately
 * stripped from the address bar so it never lingers in history or screenshots.
 */
const STORAGE_KEY = "pi-outpost:token";

/** Capture ?token= from the URL (persist + strip), then return the stored token. */
export function bootstrapToken(): string | null {
  let fromUrl: string | null = null;
  try {
    const url = new URL(window.location.href);
    fromUrl = url.searchParams.get("token");
    if (fromUrl) {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      url.searchParams.delete("token");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage/history unavailable (sandboxed iframe): the URL token still
    // drives this session in memory, it just won't persist
    return fromUrl;
  }
}

/**
 * localStorage lookup only — no URL capture. Used when embedded in a host
 * page, whose ?token= parameter (and history) belongs to the host app.
 */
export function storedToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Best effort — the in-memory copy still drives this session
  }
}
