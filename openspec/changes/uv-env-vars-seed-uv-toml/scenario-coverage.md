# Scenario coverage

Scenarios enumerated with `rg '^#### Scenario:' openspec/changes/uv-env-vars-seed-uv-toml`.

| Scenario | Status | Evidence |
| --- | --- | --- |
| UVEnvVarsSeedTheSandboxUvToml | covered | `server/test/userConfigs.test.ts` — "UVEnvVarsSeedTheSandboxUvToml: …": with no uv.toml file, the carried entry has the synthesized text from `UV_DEFAULT_INDEX`/`UV_PYTHON_INSTALL_MIRROR`; after `carryUserConfigs` with a stand-in relay, the written copy names `http://127.0.0.1:9/tok/…/repository/pypi-public-releases/simple` and the mirror path, and holds no `alice`/`s3cret`; `carriedSummary` reports "credentials kept in the server, its registries relayed"; with the variables removed the copy is removed; with a uv.toml file present, the file's `index-url` is what lands |
