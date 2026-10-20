# draw.io viewer (vendored)

`viewer-static.min.js` is jgraph's draw.io viewer, unmodified, from
[jgraph/drawio](https://github.com/jgraph/drawio) at tag `v32.5.5`
(`src/main/webapp/js/viewer-static.min.js`), under the Apache License 2.0 in `LICENSE`.
"draw.io" is a trademark of JGraph Ltd; pi-outpost is not affiliated with it.

- Version: 32.5.5
- SHA-256: 15777571ef7c042b2a4a6c6d29052f416fbaaaae5dcf868521c4a3a75f2147d8

It renders `.drawio` files in the file viewer, inside a sandboxed frame that allows it no
network access (`ui/src/components/DrawioFrame.tsx`). Move it to another release with
`node scripts/update-drawio-viewer.mjs <version>`, which rewrites this file.
