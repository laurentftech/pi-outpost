# Spec Delta

## ADDED Requirements

### Requirement: AnExecutableRunsMxcInProcess

A standalone executable built where MXC's SDK is installed SHALL carry MXC's native parts beside it —
`koffi`, its platform package, and MXC's native library — and SHALL run MXC in process from them, as an
installed pi-outpost does. Built where the SDK is not installed, it SHALL say so, and `"mxc"` SHALL be
refused by it with the reason.

#### Scenario: AnExecutableConfinesThroughTheSdk
- **GIVEN** a standalone executable built on Windows 11 with MXC's SDK installed, and the files `build-exe` placed beside it
- **WHEN** it runs with `"mxc"` as `sandbox.bashRunner`, and the agent runs a command reading a file beside the root
- **THEN** the read is refused by MXC run in process, and no executor of MXC's was started

#### Scenario: AnExecutableWithoutTheSdkSaysSo
- **GIVEN** a standalone executable built where MXC's SDK is not installed
- **WHEN** it is built, and then run with `"mxc"` as `sandbox.bashRunner`
- **THEN** the build says MXC's native parts were not placed, and the configuration is refused naming what to install
