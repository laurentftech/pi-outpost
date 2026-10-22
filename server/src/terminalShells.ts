import fs from "node:fs";
import path from "node:path";

export interface TerminalShell {
  id: string;
  label: string;
  shell: string;
  args: string[];
}

/** Resolve executables without running a shell or accepting commands from the client. */
export function findShellExecutable(command: string): string | undefined {
  const candidates = path.isAbsolute(command) ? [command] : (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, command));
  return candidates.find(candidate => {
    try {
      if (!fs.statSync(candidate).isFile()) return false;
      fs.accessSync(candidate, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
      return true;
    } catch { return false; }
  });
}

export function installedTerminalShells(options: {
  platform?: NodeJS.Platform;
  confined?: boolean;
  gitBash?: string;
  defaultShell: { shell: string; args: string[] };
  configured?: boolean;
  resolve?: (command: string) => string | undefined;
}): TerminalShell[] {
  const platform = options.platform ?? process.platform;
  const resolve = options.resolve ?? findShellExecutable;
  const shells: TerminalShell[] = [];
  const add = (id: string, label: string, shell: string, args: string[] = []) => {
    const executable = resolve(shell);
    const key = (value: string) => platform === "win32" ? value.toLowerCase() : value;
    if (executable && !shells.some(item => key(item.shell) === key(executable))) shells.push({ id, label, shell: executable, args });
  };
  if (options.configured) add("configured", "Configured shell", options.defaultShell.shell, options.defaultShell.args);
  if (platform === "win32") {
    add("powershell", "Windows PowerShell", path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), options.confined ? ["-ExecutionPolicy", "RemoteSigned", "-NoExit", "-Command", "$ProgressPreference='SilentlyContinue'"] : []);
    // Its startup update notification can crash while ConPTY is still sizing the console.
    add("pwsh", "PowerShell 7", "pwsh.exe", options.confined ? ["-NoLogo", "-ExecutionPolicy", "RemoteSigned", "-NoExit", "-Command", "$ProgressPreference='SilentlyContinue'"] : ["-NoLogo"]);
    add("cmd", "Command Prompt", process.env.COMSPEC ?? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"));
    if (!options.confined && options.gitBash) add("git-bash", "Git Bash", options.gitBash, ["-l"]);
  } else {
    add("default", path.basename(options.defaultShell.shell), options.defaultShell.shell, options.defaultShell.args);
    for (const shell of ["bash", "zsh", "fish", "sh"]) add(shell, shell, shell, shell === "sh" ? ["-l"] : options.confined && platform === "darwin" ? ["-i"] : ["-l"]);
  }
  return shells;
}
