#!/usr/bin/env bash
# The office's shape: pi-outpost in a Rocky Linux 9 container, the agent's shell under Bubblewrap
# (MXC on Linux), `sandbox.allowedHosts` set, and a scripted agent fetching an unlisted host.
# Run `npm run bench` first (host page on 4321), then open
#   http://127.0.0.1:4321/?server=http%3A%2F%2F127.0.0.1%3A4333&token=probe-token-0123456789abcdef0123456789abcdef&theme=light
# and send any message: the host question appears; the output names the Rocky release.
# Stop with: docker rm -f hq-rocky
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
image=pi-outpost-mxc-rocky
{ git ls-files -z --cached; git ls-files -z --others --exclude-standard -- server scripts; } \
  | tar --null -cf - -T - \
  | docker build -q -t "$image" -f scripts/probes/mxc-linux-rocky/Dockerfile - >/dev/null
docker rm -f hq-rocky >/dev/null 2>&1 || true
docker run -d --name hq-rocky -p 127.0.0.1:4333:4333 \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined \
  --security-opt no-new-privileges --device /dev/net/tun \
  "$image" bash -c 'arch=$(uname -m | sed "s/x86_64/x64/; s/aarch64/arm64/")
    export PROBE_RUNNER=/app/node_modules/@microsoft/mxc-sdk/bin/$arch/lxc-exec PROBE_HOST=0.0.0.0 PROBE_PORT=4333
    export PROBE_TOKEN=probe-token-0123456789abcdef0123456789abcdef
    export PROBE_COMMAND="curl -sS -o /dev/null -w \"fetched=%{http_code}\\n\" https://example.com/; cat /etc/rocky-release"
    cd /app && node --import tsx/esm scripts/probes/host-questions/serve.mts'
until docker logs hq-rocky 2>&1 | grep -qE "pi-outpost http|Error"; do sleep 2; done
docker logs hq-rocky 2>&1 | tail -1
