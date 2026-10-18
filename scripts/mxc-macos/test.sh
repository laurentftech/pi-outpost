#!/usr/bin/env bash
# macOS' sandbox runners, tested where they run: a Mac.
#
# Seatbelt through /usr/bin/sandbox-exec on every Mac; MXC's mxc-exec-mac too on Apple silicon,
# the only architecture it ships for. Both get the same checks: the agent's bash (reads, writes,
# signals, keys, git, the network) and the terminal (git, keys, size, Ctrl-C, working directory).
# Needs `npm ci` done. CI's mxc-macos job runs this on macos-latest (Apple silicon).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/server"

if [ "$(uname -s)" != Darwin ]; then
  echo "These are macOS' runners; this is $(uname -s)" >&2
  exit 1
fi
export SEATBELT_EXEC=/usr/bin/sandbox-exec
tests=(test/confinedBashSeatbelt.test.ts test/terminalSandboxSeatbelt.test.ts test/confinementCanary.test.ts)
if [ "$(uname -m)" = arm64 ]; then
  MXC_MAC_EXEC=$(node -p "require('path').join(require('path').dirname(require.resolve('@microsoft/mxc-sdk/package.json')), 'bin', 'arm64', 'mxc-exec-mac')")
  export MXC_MAC_EXEC
  tests+=(test/confinedBashMxcMac.test.ts test/terminalSandboxMxcMac.test.ts)
else
  echo "MXC ships mxc-exec-mac for Apple silicon only: Seatbelt's tests alone on $(uname -m)"
fi
node --import tsx/esm --test "${tests[@]}"
