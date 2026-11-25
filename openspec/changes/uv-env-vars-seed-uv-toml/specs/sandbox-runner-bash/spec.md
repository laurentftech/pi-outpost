# Spec Delta

## ADDED Requirements

### Requirement: UVEnvVarsSeedTheSandboxUvToml

On Windows, when the user has no `uv.toml` file but sets `UV_DEFAULT_INDEX` or `UV_PYTHON_INSTALL_MIRROR`
in their environment (HKCU\Environment), pi-outpost SHALL carry a synthesized `uv.toml` into the sandbox's
`APPDATA` with those settings, its registry URLs rewritten through the registry relay exactly as a carried
file's are — so a confined `uv pip install` / `uv sync` uses the company's Nexus index on an air-gapped
machine, the credentials staying in the server. When the user does have a `uv.toml` file, the file SHALL be
carried as before, not the synthesis. When neither exists, no copy SHALL be left. The synthesis SHALL not
propagate the `UV_*` variables themselves into the confined environment.

#### Scenario: UVEnvVarsSeedTheSandboxUvToml
- **GIVEN** a Windows host whose environment carries `UV_DEFAULT_INDEX=https://user:pass@nexus…/simple` and `UV_PYTHON_INSTALL_MIRROR=https://user:pass@nexus…/download`, and no `%APPDATA%\uv\uv.toml`
- **WHEN** a command launches confined, and the carried `uv.toml` is read where the sandbox's `APPDATA` points
- **THEN** it holds `default-index` and `python-install-mirror` at the relay's URLs, with no credential in the file; when the variables are removed, the copy goes too; and with a `uv.toml` file present, the file's content is the one carried
