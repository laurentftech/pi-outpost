/**
 * Which host a failed command was refused by the sandbox's network policy — decided from the policy,
 * not from how a program words its error.
 *
 * MXC reports no network refusal (its denial capture has files, registry keys, UI and capabilities,
 * never a connection: measured, the same report with the network open or closed). And programs say it
 * every way, or not at all: Python and Go print Windows' sentence, Node `connect EACCES`, Java
 * `Permission denied: connect`, curl and git only `Couldn't connect to server`, PowerShell `Impossible de
 * se connecter au serveur distant`. A note keyed on those words missed seven programs in ten.
 *
 * pi-outpost knows the policy it asked for. So when a command fails, the hosts it named — in its
 * command line and its output — are resolved, and each address is judged as Windows judges it in the
 * container (measured, Windows 11 24H2, mxc-sdk 1.1.0): the private network is the subnets this machine
 * is on, not every RFC 1918 range (an address off them is not refused); this machine's own addresses
 * are its loopback, as `127.0.0.0/8` is.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

/** What the agent's shell may reach without a proxy (`mxcTerminalConfig`). */
export interface NetworkPolicy {
  privateNetwork: boolean;
  hostLoopback: boolean;
}

/** A host the policy refuses, the address it resolved to, and which part of the policy refuses it. */
export interface RefusedHost {
  host: string;
  address: string;
  why: "private network" | "loopback";
}

/** One subnet of this machine: its network address and mask, as numbers. */
interface Subnet {
  network: number;
  mask: number;
}

const ipv4 = (address: string) => address.split(".").reduce((value, part) => (value << 8) + Number(part), 0) >>> 0;

/** This machine's IPv4 subnets and its own addresses, from its interfaces. */
export function localNetworks(interfaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): { subnets: Subnet[]; own: Set<string> } {
  const subnets: Subnet[] = [];
  const own = new Set<string>();
  for (const addresses of Object.values(interfaces)) {
    for (const entry of addresses ?? []) {
      if (entry.internal) continue;
      own.add(entry.address.toLowerCase());
      if (entry.family !== "IPv4") continue;
      const mask = ipv4(entry.netmask);
      subnets.push({ network: (ipv4(entry.address) & mask) >>> 0, mask });
    }
  }
  return { subnets, own };
}

/** Which part of the policy refuses `address`, if any. */
export function refusedBy(address: string, policy: NetworkPolicy, networks: { subnets: Subnet[]; own: Set<string> }): RefusedHost["why"] | undefined {
  const lower = address.toLowerCase();
  const loopback = lower === "::1" || (isIP(lower) === 4 && lower.startsWith("127.")) || networks.own.has(lower);
  if (loopback) return policy.hostLoopback ? undefined : "loopback";
  if (isIP(lower) === 4 && !policy.privateNetwork) {
    const value = ipv4(lower);
    if (networks.subnets.some((subnet) => ((value & subnet.mask) >>> 0) === subnet.network)) return "private network";
  }
  return undefined;
}

/**
 * The hosts a text names: a URL's host, `host:port`, an IPv4 address, curl's `Failed to connect to
 * <host> port <n>`. At most `limit`, in order of appearance; nothing that is plainly a file name.
 */
export function hostsNamed(text: string, limit = 12, bareAddresses = true): string[] {
  const found: string[] = [];
  const add = (host: string | undefined) => {
    const name = host?.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
    if (!name || found.includes(name) || found.length >= limit) return;
    // A name needs a dot or to be an address: `localhost` and `node:fs` are not hosts here.
    if (!isIP(name) && !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(name)) return;
    if (/\.(?:js|ts|mjs|cjs|json|py|ps1|exe|dll|txt|md|toml|ini|lock|yml|yaml|xml|html|whl|tgz|zip)$/.test(name)) return;
    found.push(name);
  };
  for (const [, host] of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@'"<>]+@)?(\[[0-9a-f:]+\]|[^\s/:'"<>?#`]+)/gi)) add(host);
  for (const [, host] of text.matchAll(/Failed to connect to (\S+) port \d+/gi)) add(host);
  for (const [, host] of text.matchAll(/\b(?:connect|dial tcp) (?:EACCES |ENETUNREACH |ECONNREFUSED )?(\d{1,3}(?:\.\d{1,3}){3}):\d+/gi)) add(host);
  if (bareAddresses) for (const [address] of text.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) add(address);
  return found;
}

/** Resolves a name to its addresses within `timeoutMs`; an address stays as it is; none on failure. */
async function addressesOf(host: string, timeoutMs: number): Promise<string[]> {
  if (isIP(host)) return [host];
  const timer = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), timeoutMs).unref());
  const resolved = lookup(host, { all: true }).then((entries) => entries.map((entry) => entry.address), () => []);
  return Promise.race([resolved, timer]);
}

/**
 * The first host named in `command` or `output` that the policy refuses, resolved as this machine
 * resolves it. Undefined when the policy refuses nothing, or no named host falls under it.
 */
export async function refusedHost(
  command: string,
  output: string,
  policy: NetworkPolicy,
  deps: { networks?: { subnets: Subnet[]; own: Set<string> }; resolve?: (host: string) => Promise<string[]>; timeoutMs?: number } = {},
): Promise<RefusedHost | undefined> {
  if (policy.privateNetwork && policy.hostLoopback) return undefined;
  const networks = deps.networks ?? localNetworks();
  const resolve = deps.resolve ?? ((host: string) => addressesOf(host, deps.timeoutMs ?? 1500));
  // The command's hosts, every way it names them; the output's only where a URL or a connection names
  // them — an address in a commit message or a log line says nothing about what failed.
  const hosts = [...new Set([...hostsNamed(command), ...hostsNamed(output, 12, false)])].slice(0, 12);
  const answers = await Promise.all(hosts.map(async (host) => ({ host, addresses: await resolve(host) })));
  for (const { host, addresses } of answers) {
    for (const address of addresses) {
      const why = refusedBy(address, policy, networks);
      if (why) return { host, address, why };
    }
  }
  return undefined;
}
