# Scenario coverage — sea-carries-image-and-codemode-runtimes

`server/test/seaInlineAssets.test.mjs` bundles the SDK's real `read` tool and codemode tool the
way the executable's bundle is built — ESM, every dependency inlined, the same banner and
plugin — and runs each from a fresh temporary directory with no `node_modules` above it and
nothing beside it but the picture. The same bundles without the plugin are run too, and fail
the way the executable did, so the test is shown to see the defect.

The executable itself needs Node ≥ 26 and was not built here. The full `cli/dist/pi-outpost.sea.mjs`
was built with the plugin and started as the server from an empty directory against a fake
OpenAI-compatible model: the model's request carried the PNG as an `image_url`.

## Capability: `standalone-executable` (2 scenarios)

| Scenario | Coverage | Assertion evidence |
| --- | --- | --- |
| AnImageReadInTheExecutableReachesTheModel | covered | `server/test/seaInlineAssets.test.mjs` — "an image read with read reaches the model as an image": the bundled `read` returns exactly `[{ text: "Read image file [image/png]" }, { type: "image", mimeType: "image/png" }]`; "without the plugin, …" shows the same bundle returning "Image omitted: could not be resized" |
| ACodemodeScriptRunsInTheExecutable | covered | `server/test/seaInlineAssets.test.mjs` — "a codemode script runs": the bundled `executeCodemode` throws nothing, reports "Script completed" and a line `42`; "without the plugin, …" shows it failing on `quickjs.wasm` |
