# syntax=docker/dockerfile:1
# Full coding app, distinct from openwebui/Dockerfile's tool server.
FROM node:24-bookworm-slim
ARG PI_OUTPOST_VERSION=0.59.1
ARG LANDSTRIP_VERSION=0.20.20
ARG APP_UID=1000
ARG APP_GID=1000
ARG TARGETARCH
WORKDIR /workspace
# A development image keeps make/g++ for Python packages with native extensions.
# The optional proxy CA stays in a build mount, never in an image layer.
RUN --mount=type=secret,id=proxy_ca \
    --mount=type=bind,source=.,target=/recipe \
    apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl git python3 python3-pip python3-venv make g++ \
 && if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi \
 && npm install -g npm@12.2.1 \
 && npm install -g --prefix /opt/pi-outpost --allow-scripts=node-pty,koffi --no-audit --no-fund "pi-outpost@${PI_OUTPOST_VERSION}" \
 && case "${TARGETARCH}" in amd64) arch=x64 ;; arm64) arch=arm64 ;; *) echo 'Use linux/amd64 or linux/arm64' >&2; exit 1 ;; esac \
 && mkdir /opt/landstrip \
 && npm pack "@landstrip/landstrip-linux-${arch}@${LANDSTRIP_VERSION}" --ignore-scripts --pack-destination /tmp \
 && tar -xzf "/tmp/landstrip-landstrip-linux-${arch}-${LANDSTRIP_VERSION}.tgz" -C /opt/landstrip --strip-components=1 \
 && cd /opt/landstrip \
 && ./bin/landstrip --appimage-extract \
 && mv squashfs-root runtime \
 && rm bin/landstrip \
 && cp /recipe/landstrip.cjs bin/landstrip \
 && chmod 755 bin/landstrip \
 && chmod -R a+rX /opt/landstrip \
 && test "${APP_UID}" -gt 0 && test "${APP_GID}" -gt 0 \
 && if ! getent group "${APP_GID}" > /dev/null; then groupmod -g "${APP_GID}" node; fi \
 && usermod -g "${APP_GID}" node \
 && if [ "${APP_UID}" != 1000 ]; then usermod -u "${APP_UID}" node; fi \
 && mkdir -p /data/agent /workspace /opt/pi-outpost-docker \
 && chown -R "${APP_UID}:${APP_GID}" /data /workspace /home/node \
 && cp /recipe/bootstrap.mjs /recipe/config.json /recipe/entrypoint.sh /opt/pi-outpost-docker/ \
 && chmod 644 /opt/pi-outpost-docker/bootstrap.mjs /opt/pi-outpost-docker/config.json \
 && chmod 755 /opt/pi-outpost-docker/entrypoint.sh \
 && npm cache clean --force \
 && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/*.tgz
ENV PATH=/opt/pi-outpost/bin:/opt/landstrip/bin:$PATH \
    XDG_CONFIG_HOME=/data/config \
    XDG_CACHE_HOME=/data/cache
USER node
EXPOSE 3141
ENTRYPOINT ["/opt/pi-outpost-docker/entrypoint.sh"]
