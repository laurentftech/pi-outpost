# Design

The root allowScripts policy pins reviewed esbuild, koffi, node-pty and fsevents versions.
Google genai's preinstall is a no-op; protobufjs postinstall only prints a version advisory:
explicitly deny these rather than running unnecessary code. strict-allow-scripts makes
future unreviewed scripts a failed repository install, including new dependency versions.

Consumer global/npx installs do not inherit the repository policy. Commands explicitly
approve only node-pty and koffi by resolved package identity. Global updates preserve
these same permissions; registry values remain environment data on Windows. No broad
all-scripts, Git or remote-URL permissions are introduced.

The installation smoke test packs the built CLI, uses two fresh caches and an isolated
prefix/user configuration, checks CLI version, then starts the installed server, opens its terminal over WebSocket and reads real PTY
output and exit code. A lifecycle canary verifies unknown code is blocked, including with
selective consumer approval; strict-project installation must report ESTRICTALLOWSCRIPTS.
The checker uses node + npm_execpath, so npm.cmd never needs direct spawn on Windows.
