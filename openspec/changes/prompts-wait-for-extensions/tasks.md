# Tasks

- [x] 1.1 `embeddedRuntime.ts`: track the binding; `prompt()` waits for it; abort releases a waiting prompt with an error; the snapshot carries `extensionsBinding`; the bind grace drops to one second.
- [x] 1.2 `protocol.ts`, `agentRuntime.ts`, `index.ts`: `extensionsBinding` in the session snapshot.
- [x] 1.3 `useAgent.ts`, `App.tsx`: the held message reads "waiting for extensions to start…" with cancel.
- [x] 1.4 `server/test/promptWaitsForExtensionsWire.test.mjs`, `ui/src/useAgent.test.ts`, `ui/src/App.test.tsx`.
- [x] 1.5 Driven in the running app: `scripts/probes/prompt-waits-for-extensions-ui.mts`.
