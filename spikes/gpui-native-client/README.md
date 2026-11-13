# pi-outpost GPUI spike

Experimental native-client spike. This is not part of the published npm package and does not change the default web launch path.

## Initial platform and GPUI feasibility

The first target is macOS x86_64, matching the current development host (`Darwin x86_64`). Rust/Cargo 1.98.1 and Xcode command-line tooling are present. Crates.io provides `gpui` 0.2.2 (Apache-2.0).

A minimal `Application::new()` / `open_window()` GPUI app is scaffolded in `src/main.rs`. This host is `x86_64` (AMD64), running Xcode 26.3 (build 17C529).

The default GPUI build precompiles its shaders with `xcrun metal`, which requires Xcode's separately downloaded Metal Toolchain. It was initially missing (two `xcodebuild -downloadComponent MetalToolchain` attempts failed fetching Xcode's component catalog). It is now installed (`xcodebuild -showComponent MetalToolchain`: build 17C7003j, status `installed`), and the **default build succeeds** — `runtime_shaders` is no longer needed on this host. It remains a fallback when the toolchain is unavailable: `--features gpui/runtime_shaders` skips `xcrun metal` and compiles shader source via Metal at runtime. References: [Apple downloadable components index](https://devimages-cdn.apple.com/downloads/xcode/simulators/index2.dvtdownloadableindex), [Tuist's Xcode/Metal Toolchain mapping investigation](https://github.com/tuist/tuist/pull/13312), and [runner-images report on intermittent catalog failures](https://github.com/actions/runner-images/pull/15318).

### `font-kit` is required on macOS

`gpui` is declared with `default-features = false` to avoid pulling in Linux/Windows backends. That also dropped `font-kit`, and without it GPUI's macOS platform falls back to `NoopTextSystem` (`gpui-0.2.2/src/platform/mac/platform.rs`): layout and coloured boxes render, but no glyph is drawn. `Cargo.toml` therefore enables `features = ["font-kit"]` explicitly.

## Existing server protocol mapping

The source of truth is `shared/src/protocol.ts`; this spike consumes a narrow subset rather than trying to translate the whole TypeScript union into Rust.

| Direction | Wire message | Native-client use |
| --- | --- | --- |
| Server to client | `hello` (`SessionSnapshot`) | Initial `sessionId`, `model`, `isStreaming`, and ordered `items` snapshot; `ChatItem` is a discriminated union of `user`, `assistant`, `tool`, `custom`, and `compaction`. |
| Client to server | `{ "type": "prompt", "text": "..." }` | Submit a text prompt. |
| Server to client | `user`, `agent_start`, `assistant_start`, `block_delta`, `assistant_end`, `agent_end` | Render user entry and in-flight state, append assistant text deltas, finalize assistant messages, and settle the turn. A connecting client can receive a snapshot while streaming; assistant items may be marked `streaming`. |
| Server to client | `tool_start`, `tool_update`, `tool_end` | Display tool activity and result in the conversation. |
| Server to client | `error` | Surface server refusal or runtime error. |

Wire records are JSON objects with a `type` discriminator. The Rust side should deserialize only the fields it needs and tolerate additional fields, rather than attempting to mirror all of `ServerMessage` and `ClientMessage`. The existing browser client is implemented in `ui/src/useAgent.ts`; any skipped protocol details must be confirmed against its reducer and real-server tests before extending the vertical slice.

## Connection and readiness

- Connect to `/ws` on the actual local server URL. A non-browser/native client may omit `Origin`; the server explicitly permits missing `Origin` for native/local clients.
- When a shared token is configured, use the native WebSocket `Authorization: Bearer …` handshake header. The server accepts this and closes unauthenticated WebSockets with application close code `4401`. Do not put the token in the URL, argv, or logs.
- `GET /health` returns `503` until the agent runtime is ready. For token-protected servers it returns only `{ "ok": true }`, deliberately hiding the session id. Use it as a readiness probe, not as a source of the listening port or session snapshot.
- The actual listening URL is printed after `app.listen()` resolves, including the OS-selected port when configured with `port: 0`.
- Existing auth coverage is in `server/test/auth.test.mjs`: valid token snapshot, missing/wrong token rejected with `4401` before data, and `/branding` Bearer token behavior. The authenticated/unauthenticated handshake has not yet been exercised against the native client (only token-less servers were used).

## Client behavior implemented

The Rust client uses the existing WebSocket endpoint (`ws://127.0.0.1:3141/ws` by default, override with `PI_OUTPOST_URL`) and sends prompts as `{ "type": "prompt", "text": "…" }`. It displays the hello snapshot, text assistant deltas and tool activity, and reports connection/server errors in the window. Focus the window, type a prompt, and press Enter. Protocol mapping tests cover snapshot content, prompt/stream/tool events, server errors and unknown future message kinds.

The prototype takes its optional Bearer token from inherited `PI_OUTPOST_TOKEN`, sends it only in the WebSocket Authorization header, and does not put it in argv or logs. This is a development handoff, not a hardened credential store.

## Build and run

```sh
# Build (default: precompiled Metal shaders; needs the Metal Toolchain)
cargo build --manifest-path spikes/gpui-native-client/Cargo.toml
# Fallback without the Metal Toolchain
cargo build --manifest-path spikes/gpui-native-client/Cargo.toml --features gpui/runtime_shaders

cargo test --manifest-path spikes/gpui-native-client/Cargo.toml

# Start a server (the dev script uses pi-outpost.config.dev.json and the default agent dir)
npm run dev:server
# Then, in another terminal
./spikes/gpui-native-client/target/debug/pi-outpost-gpui-spike
```

To isolate the client from slow or blocking extension tools, run the server with a config containing `"noExtensions": true` (e.g. `node --import tsx --import ./src/providerStackHook.mjs src/index.ts --config <that config>` from `server/`).

## Findings from a live run (2026-11-13, macOS x86_64)

Verified against a real `pi-outpost` dev server, with the window inspected by the user:

| Check | Result |
| --- | --- |
| Default (Metal) build, debug | Succeeds (≈ 4m47 clean) |
| `cargo test` | 3 passed, 0 failed |
| Native window and text rendering | Works once `font-kit` is enabled |
| WebSocket connection and `hello` snapshot | Works (status `Connected`, snapshot items rendered) |
| Prompt → `user` / `assistant_start` / `block_delta` / `assistant_end` / `agent_end` | Works: a full turn streamed and settled |
| `tool_start` | Rendered (`Tool: Running openlore_orient`) |

Observations and defects found in the running app:

- **A slow extension tool looks like a hang.** With extensions loaded from the default agent dir, a plain "hello" made the model call `openlore_orient`, which stayed `running` on the server; the client faithfully showed `Running openlore_orient` with no progress, busy indicator or cancel. Not a client bug, but the client has no way to tell "busy" from "stuck".
- **Assistant errors are dropped.** A provider `429 Rate limit exceeded` is stored on the assistant item as `errorMessage`; the client ignores that field and shows an empty `Assistant:` line. This violates the intent of task 2.3 (no silent failure).
- **Retries leave ghost entries.** One failed turn produced three empty `Assistant:` lines live, while the server snapshot holds a single errored item: live state diverges from the state rebuilt on reconnect.
- **No scrolling.** The transcript overflows its panel and below the composer; later replies are clipped out of view.
- **Tool entries are appended, not updated.** Each `tool_update`/`tool_end` adds a line instead of updating the tool's entry.

Takeaway: consuming the protocol from Rust is easy; the transport is not the cost. The cost is reproducing the state semantics that `ui/src/useAgent.ts` (≈ 3,250 lines) already handles — errors, retries, in-progress state, replacement of entries — plus rendering.

## Effort to port the web UI to GPUI

Measured size of the current web client:

| Item | Size |
| --- | --- |
| `ui/src` excluding tests | ≈ 30,500 lines TS/TSX, 71 components |
| `ui/src/components/` | ≈ 16,700 lines |
| `ui/src/presentations/` | ≈ 4,200 lines (timeline, diff, structured exchange, code search) |
| `ui/src/useAgent.ts` (protocol state/reducer) | ≈ 3,250 lines |
| Protocol | 168 message variants in `shared/src/protocol.ts` |
| Heavy web dependencies | CodeMirror (15 languages + merge), xterm, pdf.js, mermaid, KaTeX, remark/rehype, highlight.js, docx, posters editor, draw.io (iframe) |

The server also sends **pre-rendered HTML** (`callHtml`, `outputHtml`, `contentHtml`, and their collapsed variants). GPUI cannot display it, so a native client needs either a native renderer for those payloads or a protocol change towards structured data.

Rough estimate for one engineer experienced with Rust and GPUI (order of magnitude, derived from size and dependencies, not from reading every component):

| Tier | Scope | Effort |
| --- | --- | --- |
| 1. Usable chat | Markdown, code highlighting, collapsible tools, errors, retries, scroll, sessions, model picker, queued prompts, extension questions, port of `useAgent` semantics | 1.5–2 months |
| 2. Core parity | File tree, code viewer/editor, diff, terminal (PTY + emulator), settings, multi-project workspaces, git | + 3–5 months |
| 3. Rich renderers | PDF, mermaid, draw.io, KaTeX, docx/pptx/xlsx viewers, posters, structured exchange, exports | + 6 months or more — rendering engines to rewrite, with no mature Rust/GPUI equivalent |
| Cross-cutting | Windows/Linux builds, packaging, signing, CI, accessibility | + 1–2 months |

**Full parity: ≈ 12–15 engineer-months**, followed by permanent double maintenance (every UI feature built in React and in GPUI). A GPUI component library (e.g. gpui-component) might cut tiers 1–2 by 30–40 %; not evaluated here.

## A desktop shell is not a native client

A Tauri/wry-style shell displays the same web UI in the system webview (WKWebView on macOS, WebView2 on Windows). For the user it is essentially a browser without an address bar. pi-outpost already covers most of that: the `web-app-installation` spec serves a PWA manifest with `display: standalone`, so an installed interface already runs in its own window with its own icon.

What a shell would add over the PWA:

- **Lifecycle**: start the server with the window and stop it on close — the subject of this change's tasks 3.x, which a PWA cannot do.
- **Distribution**: one installable `.app`/`.exe` that does not depend on a PWA-capable browser (Firefox cannot install PWAs; Safari offers "Add to Dock").
- **OS integration**: native menus, menu-bar icon, global shortcut, file associations.

Cost: on macOS WKWebView is Safari's engine, not Chromium, adding an engine to test pdf.js, CodeMirror, xterm and mermaid against.

## Recommendation

| Goal | Answer |
| --- | --- |
| Interface in its own window | **Already done** (PWA) |
| An app that starts and stops its own server | A `pi-outpost desktop` launcher that starts the server and opens the installed PWA, or a thin shell: days of work, no UI change |
| A truly native interface (performance, feel, no web engine) | GPUI — but that is the ≈ 12–15 engineer-month effort above |

**No-go for a full GPUI port** at this stage. The decision hinges on what "native" must deliver that the PWA does not: if it is lifecycle, solve it without GPUI; if it is native feel, only GPUI delivers it, at a high and permanent cost. A narrow GPUI companion (tier 1 only: quick chat, notifications) remains an option if that specific value is wanted.

## Open constraints

- Only macOS x86_64 was exercised. Windows/Linux GPUI builds were not attempted.
- Endpoint/token environment variables support direct development use, but the CLI has not yet handed configured server credentials to the native process, and token-protected handshakes were not run against the native client.
- Reuse of a pre-existing server cannot be inferred merely from a port being occupied. The launcher needs an explicit endpoint/identity decision and must track a spawned child's ownership if it starts one.
- The native binary is not packaged with the npm CLI. How a development-only spike is invoked from the CLI, and whether native binaries would ever be shipped, remains to be resolved before production integration.
