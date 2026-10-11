# The planning tool server for Open WebUI.
#
# Built from the repository root, because the server reuses shared/, apps-core/ and
# office/, and the viewer bundles ui/'s TimelineView:
#
#     docker build -f openwebui/Dockerfile -t pi-outpost-openwebui .
#
# Run next to Open WebUI on an internal network; nothing needs to be published.
# See docs/openwebui.md.

FROM node:24-slim AS build
WORKDIR /repo
# Every workspace's manifest, so `npm ci` sees the same workspace graph as the lockfile.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
COPY embed/package.json embed/
COPY cli/package.json cli/
COPY ui/package.json ui/
COPY apps-core/package.json apps-core/
COPY office/package.json office/
COPY openwebui/package.json openwebui/
RUN npm ci --workspace @pi-outpost/openwebui --include-workspace-root=false --ignore-scripts --no-audit --no-fund
COPY shared/ shared/
COPY ui/src/ ui/src/
COPY apps-core/ apps-core/
COPY office/ office/
COPY skills/structured-exchange/references/ skills/structured-exchange/references/
COPY openwebui/ openwebui/
RUN npm run build:viewer --workspace @pi-outpost/openwebui \
 && npm run build:server --workspace @pi-outpost/openwebui \
 && node openwebui/scripts/copy-runtime-modules.mjs node_modules /runtime/node_modules jsdom @napi-rs/canvas @resvg/resvg-js

FROM node:24-slim
ENV NODE_ENV=production \
    OUTPOST_HOST=0.0.0.0 \
    OUTPOST_PORT=8790 \
    OUTPOST_DATA_DIR=/data
WORKDIR /app
# One font family: Mermaid's labels are measured and drawn in it, so they fit their boxes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
# The bundled server and Mermaid's worker, the viewer it embeds and the guide it serves,
# and the three packages that cannot be bundled (two native, jsdom reads its own files),
# copied with their dependencies at the versions the lockfile installed.
COPY --from=build /repo/openwebui/dist/server.mjs dist/server.mjs
COPY --from=build /repo/openwebui/dist/mermaid-worker.mjs dist/mermaid-worker.mjs
COPY --from=build /repo/openwebui/dist/viewer dist/viewer/
COPY --from=build /repo/openwebui/dist/guide dist/guide/
COPY --from=build /runtime/node_modules node_modules/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8790
CMD ["node", "dist/server.mjs"]
