import { useEffect, useRef, useState } from "react";

interface SandboxConfig {
  root: string;
  allowWrite: boolean;
  allowBash: boolean;
  writableRoot?: string;
  locks?: { root?: boolean; allowWrite?: boolean; allowBash?: boolean; writableRoot?: boolean };
}

interface SettingsMenuProps {
  extensionPaths: string[];
  sandbox: SandboxConfig | null;
  onUpdateConfig: (sandbox: SandboxConfig) => void;
}

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function handler(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return ref;
}

export function SettingsMenu({ extensionPaths, sandbox, onUpdateConfig }: SettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [sandboxRoot, setSandboxRoot] = useState("");
  const [sandboxWritableRoot, setSandboxWritableRoot] = useState("");
  const [sandboxAllowWrite, setSandboxAllowWrite] = useState(false);
  const [sandboxAllowBash, setSandboxAllowBash] = useState(false);
  const [applying, setApplying] = useState(false);
  const ref = useClickOutside(() => setOpen(false));

  // Sync local state when sandbox config changes (e.g. after apply ack)
  useEffect(() => {
    if (sandbox) {
      setSandboxRoot(sandbox.root);
      setSandboxWritableRoot(sandbox.writableRoot ?? "");
      setSandboxAllowWrite(sandbox.allowWrite);
      setSandboxAllowBash(sandbox.allowBash);
    }
  }, [sandbox]);

  function close() {
    setOpen(false);
    setApplying(false);
  }

  function handleApply() {
    if (!sandbox) return;
    setApplying(true);
    // Always send all fields; the server enforces locks, so skipping locked
    // fields here would fail server-side validation (typeof check on missing bools).
    const payload: SandboxConfig = {
      root: sandboxRoot,
      allowWrite: sandboxAllowWrite,
      allowBash: sandboxAllowBash,
      writableRoot: sandboxWritableRoot.trim() || undefined,
    };
    onUpdateConfig(payload);
    close();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Settings"
        aria-label="Settings"
        className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
      >
        ⚙
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 flex max-h-[80vh] w-[380px] flex-col rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">Settings</h2>
          </div>

          <div className="min-h-0 overflow-y-auto p-4">
            {/* Extensions section */}
            <section className="mb-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Extensions
              </h3>
              {extensionPaths.length === 0 ? (
                <p className="text-xs text-zinc-400 dark:text-zinc-500">No extensions loaded</p>
              ) : (
                <ul className="space-y-1">
                  {extensionPaths.map((p, i) => (
                    <li key={i} className="overflow-x-auto whitespace-nowrap rounded bg-zinc-50 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" title={p}>
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Sandbox section */}
            {sandbox && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  Sandbox
                </h3>
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Root {sandbox.locks?.root ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                      <input
                        type="text"
                        value={sandboxRoot}
                        onChange={(e) => setSandboxRoot(e.target.value)}
                        disabled={sandbox.locks?.root}
                        className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-500"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Writable root (optional) {sandbox.locks?.writableRoot ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                      <input
                        type="text"
                        value={sandboxWritableRoot}
                        onChange={(e) => setSandboxWritableRoot(e.target.value)}
                        disabled={sandbox.locks?.writableRoot}
                        placeholder="Same as root"
                        className="mt-1 w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:placeholder:text-zinc-600 dark:focus:border-zinc-500"
                      />
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sandboxAllowWrite}
                        onChange={(e) => setSandboxAllowWrite(e.target.checked)}
                        disabled={sandbox.locks?.allowWrite}
                        className="rounded border-zinc-300 text-zinc-700 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Allow write {sandbox.locks?.allowWrite ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sandboxAllowBash}
                        onChange={(e) => setSandboxAllowBash(e.target.checked)}
                        disabled={sandbox.locks?.allowBash}
                        className="rounded border-zinc-300 text-zinc-700 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      />
                      <span className="text-xs text-zinc-600 dark:text-zinc-400">
                        Allow bash {sandbox.locks?.allowBash ? <span className="text-zinc-400">(locked)</span> : null}
                      </span>
                    </label>
                  <button
                    type="button"
                    disabled={applying || !sandboxRoot.trim()}
                    onClick={handleApply}
                    className="w-full rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
                  >
                    {applying ? "Applying…" : "Apply & restart session"}
                  </button>
                  <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    File browser paths update immediately. Agent tools (read/write/bash) use the new sandbox after a server restart.
                  </p>
                </div>
              </section>
            )}
            {!sandbox && (
              <p className="text-xs text-zinc-400 dark:text-zinc-500">No sandbox configured</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
