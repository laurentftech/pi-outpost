# Prototype findings (2026-10-04)

**Setup:**
- Open WebUI `ghcr.io/open-webui/open-webui:v0.11.4` (released 2026-09-21), in Docker, no volume.
- Model `codestral-latest` (Mistral).
- A throwaway Node OpenAPI server on the host, declared as a **global** tool server with bearer
  auth.
- One tool, `show_timeline(mode)`, answering `text/html` with `Content-Disposition: inline`.
- Driven through the real UI with Playwright. The API route (`/api/chat/completions` with
  `tool_ids`) did not attach server tools: the prompt held no tool. The UI is what was tested.

## 1. Embeds

| Mode | What the tool answered | Result |
|---|---|---|
| `inline` | HTML with the viewer script inlined (1.4 kB) | Rendered as `srcdoc` iframe, scripts ran |
| `large` | Same, padded to 400 kB | Rendered, scripts ran |
| `shell` | HTML loading `<script src="http://127.0.0.1:8765/viewer.js">` | Rendered when the browser reaches the server |
| `unreachable` | Same, from an unresolvable host | Our fallback message showed. No error leaked to the page |
| `location` | JSON body, `Content-Disposition: inline` + `Location: <url>` | Iframe with `src=<url>`: the page is served by our server, and the chat stores only the URL |

**Frame and messaging:**
- The sandbox is `allow-scripts allow-popups allow-downloads`, with no same-origin.
- `input:prompt` from a click filled the chat input with the text, and **did not submit**.
- `iframe:height` is honoured; it sets the frame height.
  - My prototype measured `documentElement.scrollHeight`, which never drops below the frame's
    default 150 px.
  - The viewer must measure its own content element.
- Open WebUI logs a `SecurityError` trying to set `window.args` on the frame. Its own code, harmless:
  the planning data travels in the HTML.

**Persistence:** all five embeds were still there and still worked after a page reload, and after
navigating away and back to the chat.

**What the model sees:** for an external tool, an inline HTML (or `Location`) answer is replaced, for
the model, by a fixed `{"status":"success","code":"ui_component","message":"<tool>: Embedded UI result
is active and visible to the user."}` (`utils/middleware.py`, `process_tool_result`). The text summary
the spec asked `show` to carry never reaches the model over HTTP. The model must read a planning with
`get_planning`.

## 2. Identity forwarded to a global tool server

The global tool server was called from Open WebUI's backend (`user-agent: Python/3.11 aiohttp`), with
the connection's bearer key, in every case.

**`ENABLE_FORWARD_USER_INFO_HEADERS=true`, no JWT secret:**
```
x-openwebui-user-name: alice
x-openwebui-user-id: 2d95199f-1f70-4690-9b4a-8f98280ca9da
x-openwebui-user-email: alice@proto.local
x-openwebui-user-role: admin
x-openwebui-chat-id: 040539c8-…
x-openwebui-message-id: b5ce1537-…
```

**…plus `FORWARD_USER_INFO_HEADER_JWT_SECRET` set:** the four `x-openwebui-user-*` headers are
**replaced** by a single signed token.
```
x-openwebui-user-jwt: eyJhbGciOiJIUzI1NiIs…
x-openwebui-chat-id: d49025b6-…
x-openwebui-message-id: 73173f2f-…

header  {"alg":"HS256","typ":"JWT"}
payload {"sub":"671fa9fb-…","email":"bob@proto.local","name":"bob","role":"admin",
         "iss":"open-webui","iat":1791110855,"exp":1791111155}
```
The token lasts 300 s by default (`FORWARD_USER_INFO_HEADER_JWT_EXPIRES_SECONDS`).

**`ENABLE_FORWARD_USER_INFO_HEADERS` unset:** no `x-openwebui-*` header at all, so no identity.

## 3. Also noticed

Open WebUI 0.11 has workspace **skills**, listed to the model with automatic discovery. They are a
place for the planning guidance beyond the tool descriptions. That is a later change, not this one.

## 4. Found later, with the real viewer: embeds must hold no `&`

**What happened:** the first real embed, the 265 kB viewer with React, was accepted by Open WebUI
(the model got the `ui_component` message) but never drawn.

**Cause, in v0.11.4's own code:**
- the embed is stored with `JSON.stringify` (`structuredOutput.ts`, `stringifyAttribute`);
- it is read back through `html-entities`' `decode` before `JSON.parse` (`ToolCallDisplay.svelte`,
  `ConsecutiveDetailsGroup.svelte`).

React's bundle carries `&quot;` and `&amp;` as literal strings. They decode into raw quotes inside
the JSON, the parse fails, and the failure is swallowed. The prototype page had no `&`, which is why
it passed.

**Fix:**
- the page carries the stylesheet, the viewer and the planning gzipped and base64-encoded, an
  alphabet with no `&`;
- a bootstrap with no `&` inflates them with `DecompressionStream`;
- the embed shrank from 265 kB to 111 kB;
- `test/show.test.ts` asserts the page holds no `&`, even for a planning titled "R&D".

**Upstream:** fixed on Open WebUI's `dev` branch by `c7caa1421` (2026-09-30), "fix: tool HTML embeds
vanish when the HTML contains entities like &quot; (#31390)", which encodes the entities before
storing. It is not in a release yet (v0.11.4, `main`). The workaround stays: it serves deployments
that stay on 0.11.x, and halves what every chat stores.

**Verified in the running app:**
- Codestral called `list_plannings` then `show_planning`;
- the 9-task demo programme drew with all four dependency types;
- the frame sized itself to 578 px;
- clicking a milestone or a task label filled the input, and nothing was sent.

## 5. Weak models copy an example that looks like the request

**What happened:** Codestral was asked, in French, for a website-redesign planning. The creation
example in the tool description was also a website redesign. The model stored:
- the example's English labels ("Website redesign", "Mock-ups");
- the example's dates, 02-26 and 05-28, where the user said "fin février" and "fin mai".

**Fix:**
- the example is now a greenhouse construction in 2031, which no request will resemble;
- the description says to write in the user's language with the user's names and exact dates
  ("end of May" is the 31st), and to take only the form from the example.

**Re-run, same request:** "Refonte du site web", "Maquettes", "Revue de design", "Développement",
"Mise en ligne", with 2027-01-15 → 2027-02-28, 2027-03-05, 2027-03-08 → 2027-05-31 and 2027-06-15.
