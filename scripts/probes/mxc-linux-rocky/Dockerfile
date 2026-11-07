# The MXC Linux (Bubblewrap) tests on Rocky Linux 9, to compare with scripts/mxc-linux (Debian).
# Built like scripts/mxc-linux/test.sh: from the working tree, piped as the build context.
FROM node:24-bookworm AS node
FROM rockylinux:9
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
RUN dnf install -y -q epel-release && dnf install -y -q bubblewrap slirp4netns iptables-nft iproute git ca-certificates python3 make gcc-c++ findutils procps-ng && dnf clean all
RUN (update-alternatives --set iptables /usr/sbin/iptables-nft 2>/dev/null || true) && npm install -g npm@12.2.1
RUN useradd -m node
WORKDIR /app
COPY . .
RUN chown -R node:node /app
USER node
RUN npm ci --no-audit --no-fund --loglevel=error --maxsockets=4 --workspace server --workspace shared --workspace office --include-workspace-root=false
WORKDIR /app/server
