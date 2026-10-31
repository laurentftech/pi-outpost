# draw.io viewer (vendored)

`viewer-static.min.js` is jgraph's draw.io viewer, unmodified, from
[jgraph/drawio](https://github.com/jgraph/drawio) at tag `v32.6.9`
(`src/main/webapp/js/viewer-static.min.js`), under the Apache License 2.0 in `LICENSE`.
"draw.io" is a trademark of JGraph Ltd; pi-outpost is not affiliated with it.

- Version: 32.6.9
- SHA-256: 21f5b0a744765eba94fdc14f4006f2e024ef01635579f421191529f4712b57b7

It renders `.drawio` files in the file viewer, inside a sandboxed frame that allows it no
network access (`ui/src/components/DrawioFrame.tsx`). Move it to another release with
`node scripts/update-drawio-viewer.mjs <version>`, which rewrites this file.

`server/src/drawioRoutes.ts` ports the part of this release's routing that `drawio_check` needs
to see where wires run (mxGraph's mxGraphView, mxEdgeStyle and mxPerimeter, and draw.io's
overrides in `js/grapheditor/Graph.js`), under the same licence. After moving the viewer to
another release, run `e2e/drawio-routes.spec.ts`: it holds the port's routes to this viewer's.
