// Probe: the Word and PowerPoint wrappers for every poster format, from one picture —
// an A4 picture on a 16:9 slide shows the letterboxing. Look at the files with Quick Look:
//   node --import tsx scripts/probes/poster-export-formats.mts <picture.png> <out-dir>
//   qlmanage -t -s 600 -o <out-dir> <out-dir>/*.docx <out-dir>/*.pptx
import fs from "node:fs/promises";
import path from "node:path";
import { FORMAT_NAMES } from "../../posters/src/format.ts";
import { posterDocx, posterPptx } from "../../posters/src/office.ts";

const [picturePath, out] = process.argv.slice(2);
const png = await fs.readFile(picturePath!);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
for (const format of FORMAT_NAMES) {
  const name = format.replace(":", "x");
  await fs.writeFile(path.join(out!, `${name}.docx`), posterDocx(format, format, { png, width, height }));
  await fs.writeFile(path.join(out!, `${name}.pptx`), posterPptx(format, { png, width, height }));
}
console.log("written", FORMAT_NAMES.length * 2, "files to", out);
