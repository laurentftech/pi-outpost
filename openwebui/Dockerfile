# The planning tool server for Open WebUI.
#
# Built from the repository root, because the server reuses shared/ and the viewer
# bundles ui/'s TimelineView:
#
#     docker build -f openwebui/Dockerfile -t pi-outpost-plannings .
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
COPY openwebui/package.json openwebui/
RUN npm ci --workspace @pi-outpost/openwebui --include-workspace-root=false --ignore-scripts --no-audit --no-fund
COPY shared/ shared/
COPY ui/src/ ui/src/
COPY skills/structured-exchange/references/ skills/structured-exchange/references/
COPY openwebui/ openwebui/
RUN npm run build:viewer --workspace @pi-outpost/openwebui \
 && npm run build:server --workspace @pi-outpost/openwebui

FROM node:24-slim
ENV NODE_ENV=production \
    OWUI_PLANNING_HOST=0.0.0.0 \
    OWUI_PLANNING_PORT=8790 \
    OWUI_PLANNING_DATA_DIR=/data
WORKDIR /app
# One bundled file, the viewer it embeds and the guide it serves: no node_modules at run time.
COPY --from=build /repo/openwebui/dist/server.mjs dist/server.mjs
COPY --from=build /repo/openwebui/dist/viewer dist/viewer/
COPY --from=build /repo/openwebui/dist/guide dist/guide/
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8790
CMD ["node", "dist/server.mjs"]
