#!/usr/bin/env bash
# MXC's macOS executor (mxc-exec-mac, Seatbelt), tested where it runs: a Mac on Apple silicon.
#
# Runs the real-executor tests against the executor @microsoft/mxc-sdk installed: the agent's
# bash (reads, writes, signals, keys, git, the network) and the terminal (git, keys, size,
# Ctrl-C, working directory). Needs `npm ci` done. CI's mxc-macos job runs this on macos-latest.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/server"

if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo "MXC ships mxc-exec-mac for Apple silicon only; this is $(uname -s) $(uname -m)" >&2
  exit 1
fi
MXC_MAC_EXEC=$(node -p "require('path').join(require('path').dirname(require.resolve('@microsoft/mxc-sdk/package.json')), 'bin', 'arm64', 'mxc-exec-mac')")
export MXC_MAC_EXEC
node --import tsx/esm --test test/confinedBashMxcMac.test.ts test/terminalSandboxMxcMac.test.ts
