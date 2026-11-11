#!/bin/sh
# Reproduce the confined-terminal cwd test on Linux, as CI runs it: npm ci, landstrip 0.20.26.
#   docker run --rm --privileged -v "$PWD":/src:ro node:24 sh /src/scripts/probes/landstrip-cwd/run-in-docker.sh
set -e
apt-get update -qq >/dev/null && apt-get install -y -qq rsync git python3 build-essential >/dev/null
rsync -a --exclude node_modules --exclude '.git' --exclude 'spikes/statement-coverage/results' /src/ /work/
cd /work && npm ci --ignore-scripts=false --no-audit --no-fund >/tmp/npm.log 2>&1 || { tail -30 /tmp/npm.log; exit 1; }
cd /tmp && npm pack --silent @landstrip/landstrip-linux-x64@0.20.26 >/dev/null && mkdir -p ls && tar xzf landstrip-landstrip-linux-x64-0.20.26.tgz -C ls
(cd ls && ./package/bin/landstrip --appimage-extract >/dev/null)
export LANDSTRIP_BIN=/tmp/ls/squashfs-root/usr/bin/landstrip
"$LANDSTRIP_BIN" doctor | tail -3
cd /work && node --import tsx scripts/probes/landstrip-cwd/probe.mts
cd /work/server && node --import tsx --test --test-name-pattern="folder reported" test/terminalSandboxReal.test.ts 2>&1 | grep -E "^ℹ (pass|fail)|✖|actual|expected" | head
