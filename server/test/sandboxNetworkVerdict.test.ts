/**
 * A failed command's refusal by the sandbox's network policy, decided from the policy and the hosts it
 * named, not from how each program words its error (`sandboxNetworkVerdict.ts`).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hostsNamed, localNetworks, refusedBy, refusedHost } from "../src/sandboxNetworkVerdict.ts";
import { socketRefusedNote } from "../src/confinedBash.ts";

// A machine on 10.0.0.0/24 at 10.0.0.5, as the measurement's was.
const networks = localNetworks({
  ethernet: [{ address: "10.0.0.5", netmask: "255.255.255.0", family: "IPv4", internal: false, mac: "", cidr: "10.0.0.5/24" }],
  loopback: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true, mac: "", cidr: "127.0.0.1/8" }],
});
const closed = { privateNetwork: false, hostLoopback: true };

describe("the sandbox's network verdict", () => {
  test("an address is judged as Windows judges it in the container: the machine's subnets, its own addresses its loopback", () => {
    assert.equal(refusedBy("10.0.0.1", closed, networks), "private network");
    assert.equal(refusedBy("10.254.254.254", closed, networks), undefined, "off the machine's subnets: not refused (measured)");
    assert.equal(refusedBy("1.1.1.1", closed, networks), undefined);
    assert.equal(refusedBy("10.0.0.5", closed, networks), undefined, "the machine's own address is its loopback, open by default");
    assert.equal(refusedBy("10.0.0.5", { privateNetwork: true, hostLoopback: false }, networks), "loopback");
    assert.equal(refusedBy("127.0.0.1", { privateNetwork: false, hostLoopback: false }, networks), "loopback");
    assert.equal(refusedBy("10.0.0.1", { privateNetwork: true, hostLoopback: true }, networks), undefined);
  });

  test("the hosts a command names, as curl, git, npm, Node, Go and uv write them", () => {
    assert.deepEqual(hostsNamed("curl.exe -sS http://nexus.corp.example:8081/x"), ["nexus.corp.example"]);
    assert.deepEqual(hostsNamed("curl: (7) Failed to connect to 10.0.0.1 port 80 after 1 ms: Couldn't connect to server"), ["10.0.0.1"]);
    assert.deepEqual(hostsNamed("Error: connect EACCES 10.0.0.1:80"), ["10.0.0.1"]);
    assert.deepEqual(hostsNamed("dial tcp 10.0.0.1:80: connectex: …"), ["10.0.0.1"]);
    assert.deepEqual(hostsNamed("git clone https://alice:pw@git.corp.example/team/repo.git"), ["git.corp.example"]);
    assert.deepEqual(hostsNamed("node index.js; cat package.json; uv.lock"), [], "file names are not hosts");
    assert.deepEqual(hostsNamed("commit 1a2b: fix 10.0.0.1 handling", 12, false), [], "a bare address in output counts for nothing");
  });

  // openlore: scenario=ASandboxRefusalIsNamed spec=sandbox-runner-bash
  test("ASandboxRefusalIsNamed: whatever the program printed, the host the policy refuses is named, resolved as the machine resolves it", async () => {
    const resolve = async (host: string) => (host === "nexus.corp.example" ? ["10.0.0.20"] : host === "pypi.org" ? ["151.101.0.223"] : []);
    // PowerShell says only that it could not connect; the command named the host.
    const found = await refusedHost("Invoke-WebRequest http://nexus.corp.example/simple/", "Impossible de se connecter au serveur distant", closed, { networks, resolve });
    assert.deepEqual(found, { host: "nexus.corp.example", address: "10.0.0.20", why: "private network" });
    assert.match(socketRefusedNote({ proxy: false, ...closed }, found), /^\[pi-outpost\] the sandbox refused nexus\.corp\.example \(10\.0\.0\.20\): it is on this machine's private network \(the intranet\), which is closed unless the user sets sandbox\.privateNetwork to true\./);
    // The Internet is not refused; the private network opened by the user is not either.
    assert.equal(await refusedHost("curl https://pypi.org/simple/", "", closed, { networks, resolve }), undefined);
    assert.equal(await refusedHost("curl http://nexus.corp.example/", "", { privateNetwork: true, hostLoopback: true }, { networks, resolve }), undefined);
    // A host the output names in a URL counts: uv names the index it could not fetch.
    assert.equal((await refusedHost("uv run pytest", "error: Failed to fetch: `http://nexus.corp.example/simple/pandas/`", closed, { networks, resolve }))?.host, "nexus.corp.example");
  });
});
