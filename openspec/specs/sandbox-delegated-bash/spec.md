# sandbox-delegated-bash Specification

## Purpose
Lets a deployment hand the agent's shell to a sandboxing extension it trusts, so commands run
confined by that extension instead of by nothing, and guarantees the session never silently runs
another shell in its place.

## Requirements

### Requirement: TheSandboxMayNameTheExtensionThatSuppliesBash

The configuration's `sandbox` MAY declare `bashFrom`, naming an extension by its package source as pi
lists it (for example `npm:pi-landstrip`) or by the path of its file or directory. A value that is
empty or blank SHALL be refused when the configuration loads. `bashFrom` SHALL apply only while
`allowBash` is on.

#### Scenario: TheDelegateIsNamedInTheSandbox
- **WHEN** the configuration declares `sandbox.bashFrom: " npm:pi-landstrip "`, then an empty one, then a blank one
- **THEN** the first loads as `npm:pi-landstrip`, and the other two are refused

### Requirement: ADelegatedBashIsTheNamedExtensions

While `allowBash` is on and `bashFrom` is set, pi-outpost SHALL supply no `bash` of its own and SHALL
leave the name to the extension, so that the `bash` the agent runs is the one the named extension
registered. Without `bashFrom`, pi-outpost's own `bash` SHALL be supplied as before, and SHALL take
precedence over an extension's tool of the same name. Without `allowBash`, no `bash` SHALL be
registered, whoever supplies one.

#### Scenario: ADelegatedBashIsTheExtensions
- **WHEN** `allowBash` is on, `bashFrom` names an extension that registers `bash`, and the agent calls `bash`
- **THEN** the extension's `bash` runs, and pi-outpost's does not

#### Scenario: WithoutDelegationTheExtensionIsShadowed
- **WHEN** `allowBash` is on, `bashFrom` is unset, the same extension is loaded, and the agent calls `bash`
- **THEN** pi-outpost's `bash` runs, and the extension's does not

#### Scenario: NoBashMeansNoDelegate
- **WHEN** `allowBash` is off and `bashFrom` names an extension that registers `bash`
- **THEN** the session registers no `bash` at all

### Requirement: AMissingDelegateRefusesTheSession

While `allowBash` is on and `bashFrom` is set, a session whose `bash` does not come from the named
extension SHALL refuse to start. The refusal SHALL name the extension `bashFrom` names and the `bash`
that was found instead: none, Pi's own, pi-outpost's, or another extension's, with its source.

#### Scenario: AMissingDelegateRefusesTheSession
- **WHEN** `bashFrom` names an extension that is not loaded
- **THEN** the server does not start, and says that `bashFrom` hands bash to that extension and that it is refusing the session

#### Scenario: AnotherExtensionsBashIsRefused
- **WHEN** `bashFrom` names one extension and another one registers `bash`
- **THEN** the server does not start, and the refusal names where the `bash` it found came from

### Requirement: SettingsPreserveTheDelegation

Applying sandbox settings from the browser SHALL keep `bashFrom`, which Settings do not edit. A change
whose new session is refused because the named extension supplies no `bash` SHALL be rolled back: the
running configuration, the session and the configuration file SHALL keep their previous values, and
the browser SHALL be told why.

#### Scenario: SettingsKeepTheDelegation
- **WHEN** a delegated sandbox is applied again from Settings and the agent then calls `bash`
- **THEN** the extension's `bash` runs

#### Scenario: TurningBashOnWithoutTheDelegateIsRefused
- **WHEN** `bashFrom` names an extension that is not loaded and Settings switch `allowBash` on
- **THEN** the change is refused with the reason, a new connection still sees `allowBash` off and no `bash`, and the configuration file still has `allowBash` off and keeps `bashFrom`

### Requirement: AShadowedExtensionBashIsReported

While `allowBash` is on and `bashFrom` is not set, a session in which an extension registers its own
`bash` SHALL be reported. The server log SHALL carry a warning, and every browser that binds to that
project SHALL receive the same warning as a notification. The warning SHALL name the extension and
say that the agent runs pi-outpost's `bash`, which is not confined, and SHALL give the `bashFrom` value
that would hand bash to that extension. No warning SHALL be given when `bashFrom` names the extension,
or when `allowBash` is off.

#### Scenario: AShadowedExtensionBashIsWarnedAbout
- **WHEN** `allowBash` is on, `bashFrom` is unset, an extension registers `bash`, and two browsers open the project one after the other
- **THEN** the server log carries the warning, and each browser receives a warning notification naming the extension, saying the bash in use is not confined, and giving the `bashFrom` line

#### Scenario: NoWarningWhenTheExtensionsBashIsUsedOrThereIsNone
- **WHEN** the same extension is loaded with `bashFrom` naming it, and then with `allowBash` off
- **THEN** no warning is logged or sent

### Requirement: ExtensionsSeeTheServersAgentDirectory

In the embedded runtime, with `agentDir` configured, an extension that looks up Pi's agent directory for
itself SHALL find `agentDir`, whatever `PI_CODING_AGENT_DIR` the server was started with. The terminal
panel SHALL keep the `PI_CODING_AGENT_DIR` the server was started with, or none.

#### Scenario: ExtensionsSeeTheServersAgentDirectory
- **WHEN** the server is started with `agentDir` set and `PI_CODING_AGENT_DIR` pointing elsewhere, and an extension looks up Pi's agent directory
- **THEN** it finds `agentDir`

#### Scenario: TheTerminalKeepsTheUsersAgentDirectory
- **WHEN** a terminal's environment is built on the server's, which carries `agentDir`
- **THEN** it carries the value the server was started with, and none when there was none, alongside the rest of the server's environment
