# The tests of MXC's Linux executor (lxc-exec, Bubblewrap backend), in the Docker deployment's shape.
# Built and run by scripts/mxc-linux/test.sh, from the working tree.
FROM node:24-bookworm

# Bubblewrap is MXC's Linux backend; slirp4netns, iptables and iproute2 (`ip`) carry any network rule.
# python3, make and g++ build node-pty for the terminal tests.
RUN apt-get update -qq \
  && apt-get install -y -qq --no-install-recommends bubblewrap slirp4netns iptables iproute2 git curl ca-certificates python3 make g++ >/dev/null \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
RUN chown -R node:node /app
USER node
# The server and the workspaces it imports, not the whole repository, a few sockets at a time:
# a full install at npm's default concurrency took Docker Desktop's engine down.
RUN npm ci --no-audit --no-fund --loglevel=error --maxsockets=4 --workspace server --workspace shared --workspace office --include-workspace-root=false

WORKDIR /app/server
# The executor for this image's architecture: x64 on a PC, arm64 on Apple silicon.
CMD ["bash", "-c", "arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/'); export MXC_LXC_EXEC=/app/node_modules/@microsoft/mxc-sdk/bin/$arch/lxc-exec; exec node --import tsx/esm --test test/confinedBashMxcLinux.test.ts test/terminalSandboxMxcLinux.test.ts test/confinementCanary.test.ts test/sandboxGrantsReal.test.ts"]
