# pi-outpost standalone web app

This private workspace is the Vite shell for the standalone pi-outpost interface. The
shared React application lives in `@pi-outpost/ui`; this package supplies the page entry
point, global stylesheet, web manifest and icons used by the server-hosted app. It has no
service worker and does not cache the interface for offline use.

## Development

From the repository root:

```bash
npm install
npm run dev
```

That starts Vite on `http://localhost:5173` and the agent server on
`http://127.0.0.1:3142`. Vite proxies `/ws`, `/branding`, `/health` and `/files` to the
server. Set `PI_OUTPOST_PORT` when the development server listens on another port.

The root command deliberately supplies
[`pi-outpost.config.dev.json`](../pi-outpost.config.dev.json) to the agent server. Running
the web workspace alone starts only Vite; it does not start or configure pi-outpost:

```bash
npm run dev --workspace web
```

## Checks and production build

```bash
npm run typecheck --workspace web
npm run lint --workspace web
npm run build --workspace web
```

The build writes `web/dist/`. `npm run start` from the repository root builds that output
and starts the server that serves it. Packaging builds may instead inline the same assets
into the CLI bundle or standalone executable; see
[`docs/sea-packaging.md`](../docs/sea-packaging.md).
