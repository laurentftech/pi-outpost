#!/bin/sh
# Runs the confined-PowerShell tests against a real pwsh, on a machine without one:
# node 24 + PowerShell 7 in a throwaway Linux container, the repository mounted read-only
# beside a copy of its node_modules-free sources.
#
#   sh scripts/probes/pwsh-in-docker.sh
set -eu
repo="$(cd "$(dirname "$0")/../.." && pwd)"
docker run --rm -v "$repo:/src:ro" node:24-bookworm sh -c '
  set -e
  apt-get update -qq >/dev/null && apt-get install -y -qq wget >/dev/null
  arch=$(dpkg --print-architecture); [ "$arch" = amd64 ] && a=x64 || a=arm64
  wget -q -O /tmp/pwsh.tgz "https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/powershell-7.4.6-linux-$a.tar.gz"
  mkdir -p /opt/pwsh && tar xzf /tmp/pwsh.tgz -C /opt/pwsh && chmod +x /opt/pwsh/pwsh && ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh
  mkdir /work && cd /src && tar cf - --exclude=node_modules --exclude=.git --exclude=dist . | tar xf - -C /work
  cd /work && npm ci --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
  cd server && node --import tsx/esm --test test/confinedPowerShell.test.ts
'
