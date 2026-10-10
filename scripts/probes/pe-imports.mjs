/**
 * The DLLs a Windows executable imports, read from its PE import table — to see what the
 * programs that fail to start inside an AppContainer (0xC0000142) have in common.
 *
 *   node scripts/probes/pe-imports.mjs <exe> [<exe>…]
 */
import { readFileSync } from "node:fs";

function imports(file) {
  const b = readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  const magic = b.readUInt16LE(pe + 24);
  const dirs = pe + 24 + (magic === 0x20b ? 112 : 96);
  const importRva = b.readUInt32LE(dirs + 8);
  const sectionCount = b.readUInt16LE(pe + 6);
  const sections = pe + 24 + b.readUInt16LE(pe + 20);
  const toOffset = (rva) => {
    for (let i = 0; i < sectionCount; i++) {
      const s = sections + i * 40;
      const va = b.readUInt32LE(s + 12), size = Math.max(b.readUInt32LE(s + 8), b.readUInt32LE(s + 16)), raw = b.readUInt32LE(s + 20);
      if (rva >= va && rva < va + size) return rva - va + raw;
    }
    return -1;
  };
  const names = [];
  for (let d = toOffset(importRva); d > 0 && b.readUInt32LE(d + 12) !== 0; d += 20) {
    const n = toOffset(b.readUInt32LE(d + 12));
    names.push(b.toString("latin1", n, b.indexOf(0, n)).toLowerCase());
  }
  return names;
}

for (const file of process.argv.slice(2)) {
  try {
    const dlls = imports(file);
    console.log(`${file}\n  user32: ${dlls.some((d) => d === "user32.dll") ? "YES" : "no"} | ${dlls.join(", ")}`);
  } catch (error) {
    console.log(`${file}\n  unreadable: ${error.message}`);
  }
}
