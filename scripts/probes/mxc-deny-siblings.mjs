// The deny list that lets native git run under MXC tier 1 with the drive root readable: every entry of
// every ancestor of the project, except the path down to it and the system folders at the root
// (docs/investigations/windows-sandboxing.md, finding 8).
//
//   node scripts/probes/mxc-deny-siblings.mjs C:\Users\me\project [keep;...]   -> ';'-joined paths
//
// Two kinds of entry make CreateProcessSecurityEnvironment refuse the whole policy, so they are left
// out: junctions and symlinks (0x8007010B; the compatibility junctions - "Application Data",
// "Documents and Settings" - point at folders that are denied, or system, anyway) and files that
// cannot be opened, such as the loaded NTUSER.DAT (0x80070020, sharing violation).
import { closeSync, lstatSync, openSync, readdirSync } from "node:fs";
import { join, parse, sep } from "node:path";

const project = process.argv[2];
const keep = new Set((process.argv[3] ?? "").split(";").filter(Boolean).map((p) => p.toLowerCase()));
const system = new Set(["windows", "program files", "program files (x86)", "programdata"]);

function deniable(path) {
  let st;
  try { st = lstatSync(path); } catch { return false; }
  if (st.isSymbolicLink()) return false; // Node reports junctions as symlinks too.
  if (st.isDirectory()) return true;
  try { closeSync(openSync(path, "r")); return true; } catch { return false; }
}

const { root } = parse(project);
const out = [];
let dir = root;
for (const part of project.slice(root.length).split(sep).filter(Boolean)) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name.toLowerCase() === part.toLowerCase() || keep.has(path.toLowerCase())) continue;
    if (dir === root && system.has(name.toLowerCase())) continue;
    if (deniable(path)) out.push(path);
  }
  dir = join(dir, part);
}
process.stdout.write(out.join(";"));
