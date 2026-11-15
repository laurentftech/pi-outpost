# Spec Delta

## MODIFIED Requirements

### Requirement: OnWindows11MxcMayConfineTheTerminal

`terminal.sandbox` MAY name MXC (`"mxc"`, or a path to one of its executors, read as `"mxc"`). On
Windows the terminal SHALL run under MXC's executor (`wxc-exec.exe`) with its policy as a file: the SDK's
ProcessContainer pseudo-terminal starts that same executor with the whole request on its command line,
which a terminal's request outgrows. It SHALL be accepted only when MXC's probe, through the SDK,
reports tier 1 (`base-container`); any other
tier, or a host other than Windows, SHALL make the terminal unavailable with the reason. Under MXC the
policy SHALL keep the read and write limits and the denied secrets of `TheTerminalMayRunConfined`, and git
SHALL be able to run in a writable root.

#### Scenario: AnMxcRunnerBelowTier1MeansNoTerminal
- **GIVEN** `terminal.sandbox` naming MXC on a host whose probe reports a tier other than `base-container`
- **WHEN** the runner is checked
- **THEN** it is refused with a reason naming the tier found and the one required

#### Scenario: OnWindowsWithMxcGitRunsConfined
- **GIVEN** a confined terminal under MXC tier 1 in a git repository that is its writable root
- **WHEN** the user runs `git status` and reads the agent directory's `auth.json`
- **THEN** git answers, and the read is refused
