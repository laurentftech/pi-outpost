# Spec Delta

## ADDED Requirements

### Requirement: TheConfinedTerminalUsesTheWindowsMxcWhitelist

Under MXC on Windows, the confined terminal's policy SHALL be the agent shell's whitelist
(`TheWindowsMxcPolicyIsAWhitelist` in `sandbox-runner-bash`): only what it opens readable or writable,
drive roots and the way down enumerable, the agent directory and the configuration file denied. A host
that cannot build it at enumeration level 1 SHALL make the terminal unavailable with the reason.

#### Scenario: TheConfinedTerminalUsesTheWindowsMxcWhitelist
- **GIVEN** a confined terminal under MXC tier 1 in a git repository, built by the same `mxcTerminalConfig` as the agent's shell (whose shape on another drive `TheWindowsMxcPolicyIsAWhitelist` pins)
- **WHEN** the user runs `git status`, then reads a file in a fresh folder beside the terminal's temporary directory, then the agent directory's `auth.json`
- **THEN** git answers, and both reads are refused
