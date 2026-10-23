# Scenario coverage

| Scenario | Status | Test evidence |
|---|---|---|
| BlackholeStyleGaugesRetainTheirColours | partial | server/test/extensionUiBridge.test.ts: semantic theme colours reach setStatus, as used by pi-blackhole; e2e/extension-status-colours.spec.ts: extension status ANSI styles survive folding, resizing and a fresh update after reload. Authored, not run in this environment. |
| HeadlessIndexedColoursRemainVisible | partial | ui/src/util/ansi.test.ts: consumes a 256-colour sequence rather than leaving its digits as text; maps indexed basic, cube endpoints and greys, and resets the colour. Real parser exercised with dependency-free Node assertions; full UI/browser suites pending. |

No existing main spec scenario covers semantic extension status colours. Existing startup contracts are unchanged. Do not mark scenarios covered based only on test names or the dependency-free checks. Full app execution is required by AGENTS.md.

| BundledStatusesWorkWithoutThemeFiles | partial | server/test/extensionUiBridgeBundled.test.mjs: bundled semantic statuses keep colours without SDK theme files; server/test/versionsBundled.test.mjs: the npm bundle names the SDK built into it, not the one it could read from disk; the bundle an executable embeds names it too, with every dependency inlined. Added after the packaged-startup CI failure; new run pending. |
