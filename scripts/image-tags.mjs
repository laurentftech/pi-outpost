/**
 * The tags a release pushes for pi-outpost's Open WebUI server image.
 *
 * Every release is pushed under its own version. Only a release on the default
 * channel moves `latest` — the same rule, from the same function, that decides the
 * npm dist-tag (release-channel.mjs), so a prerelease can never become the image a
 * deployment pulls by default while npm says otherwise.
 *
 *     node scripts/image-tags.mjs 0.34.0 ghcr.io/owner/pi-outpost-openwebui
 *     → ghcr.io/owner/pi-outpost-openwebui:0.34.0 ghcr.io/owner/pi-outpost-openwebui:latest
 */
import { DEFAULT_CHANNEL, channelFor } from "./release-channel.mjs";

export function imageTags(version, image) {
  const name = String(image).trim().toLowerCase();
  if (!name || name.includes(":")) throw new Error(`not an image name without a tag: "${image}"`);
  const tags = [`${name}:${String(version).trim()}`];
  if (channelFor(version) === DEFAULT_CHANNEL) tags.push(`${name}:latest`);
  return tags;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    process.stdout.write(imageTags(process.argv[2], process.argv[3]).join(" "));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
