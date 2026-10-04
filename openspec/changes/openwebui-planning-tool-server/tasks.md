# Tasks

## 1. Prototype the two unknowns

- [x] 1.1 Run Open WebUI locally under Docker (pinned version, recorded), with a throwaway OpenAPI
  server declared as a global tool server that returns a fixed timeline as an inline HTML embed.
  Verify by asking a model for it and seeing the embed in the chat.
- [x] 1.2 Reopen the chat, and reload the browser. Record whether the embed is still there. Do the
  same for a `shell` embed loading its script from the server, from a browser that can reach it and
  from one that cannot. Write the findings and the chosen default delivery mode into `design.md`.
  Verify: `design.md` names the Open WebUI version and the mode, with the observed behaviour.
- [x] 1.3 Record which identity headers Open WebUI actually forwards to a global tool server with
  `ENABLE_FORWARD_USER_INFO_HEADERS` on and off, from the throwaway server's request log. Correct the
  header names in `design.md` if they differ. Verify: the log excerpt is in the prototype notes.

## 2. Package and trust boundary

- [ ] 2.1 Create the private workspace package `openwebui/`:
  - Fastify, depending only on `@pi-outpost/shared`;
  - configuration for listen address (default `127.0.0.1`), port, storage root, secret, identity mode (signed or plain) and key,
    and ceilings;
  - `typecheck`, `test` and `build` scripts.

  Wire it into the root workspaces, CI and lint. Verify: `npm run typecheck` and the CI matrix include
  it, Windows too.
- [x] 2.2 Trust boundary:
  - refuse to start without a secret, or in signed mode without an identity key;
  - check the bearer token in constant time before any route;
  - signed mode: verify the HS256 token, issuer `open-webui` and expiry; the owner is `sub`, and
    plain headers are ignored;
  - plain mode: the owner is the user header.

  A request with no acceptable identity is refused. Verify with tests named after
  `TheServerWillNotStartWithoutASecret`, `SignedModeWillNotStartWithoutAKey`,
  `ARequestWithoutTheSecretIsRefused`, `ARequestWithoutAUserIsRefused`, `AForgedTokenIsRefused`,
  `AnExpiredTokenIsRefused` and `PlainHeadersAreIgnoredInSignedMode`, including that no storage is
  touched.

## 3. Storage and revisions

- [ ] 3.1 Implement the store:
  - owner directory from a hash of the user id, random planning ids;
  - one file per revision plus `meta.json`;
  - temp-file-then-rename writes, a per-planning lock;
  - ceilings on size, revisions and plannings per user.

  Verify with unit tests on a temporary directory, built with `path.join` (no string paths), covering
  `TheOldestRevisionsAreNotSilentlyLost` and `APlanningTooLargeIsRefused`.
- [x] 3.2 `create_planning`, `list_plannings` and `get_planning` (current or named revision):
  - validation through `shared/`, kind `timeline` only;
  - item ids assigned where missing.

  Verify with tests for:
  - `AValidTimelineIsCreated`, `AnInvalidTimelineIsRefusedWithDiagnostics` (diagnostics equal to
    `shared/`'s for the same document), `AnotherKindIsRefused`;
  - `AUserListsOnlyTheirOwnPlannings`, `AnotherUsersPlanningIsNotFound`;
  - `AnUnknownRevisionIsNotFound`, `ItemsWithoutIdentifiersCanBeNamedAfterCreation`.
- [x] 3.3 Verify `AStoredPlanningOpensInPiOutpost`: a test that validates a stored revision file with
  the same `shared/` check pi-outpost's structured-exchange tool applies.

## 4. Targeted updates

- [ ] 4.1 Implement the update operations from `design.md`:
  - applied to a copy, all or nothing, the first failing operation reported by index;
  - validation of the result;
  - `base_revision` check.

  Verify with tests for `MovingOneMilestoneChangesOnlyThatMilestone` (deep diff of the two revisions),
  `AnOperationOnAMissingIdentifierRefusesTheWholeUpdate`, `AnUpdateThatBreaksTheContractIsRefused`,
  `AStaleUpdateIsRefused` and `AnUpdateKeepsThePreviousRevision`.
- [ ] 4.2 Verify concurrent updates: two updates against the same base revision, sent at once,
  produce exactly one new revision and one stale refusal.

## 5. The embedded timeline

- [ ] 5.1 Add a single-file Vite build entry that mounts `TimelineView` with the planning's data:
  - optional comparison through `compareTimelines`;
  - height reporting through `ResizeObserver` → `iframe:height`;
  - `input:prompt` on a task or milestone click, never `input:prompt:submit`.

  Verify with unit tests on the entry's message posting for `ClickingAMilestoneFillsTheInput`.
- [ ] 5.2 `show_planning`: self-contained HTML (viewer inlined, planning as JSON in the page) with
  `Content-Type: text/html` and `Content-Disposition: inline`. Expose `Content-Disposition` to CORS.
  The page makes no request to the server. Verify with tests for
  `ShowingAPlanningEmbedsTheTimeline` and `ShowingAComparisonDrawsWhatMoved` (the comparison present
  in the embedded data).
- [ ] 5.3 Verify `TheEmbedRunsInTheDefaultSandbox` in a Playwright test:
  - a host page frames the HTML with `sandbox="allow-scripts"` and no same-origin;
  - check from the DOM that it draws every item, changes scale and opens details;
  - check from the host's received messages that it reports a height and fills, never submits.

## 6. Tool descriptions and OpenAPI

- [ ] 6.1 Generate the OpenAPI document from the route schemas. Write the five tool descriptions with
  a complete creation example and a complete update example. Verify with tests for
  `TheDescriptionNamesTheFiveTools`, `TheCreationExampleIsValid` and `TheUpdateExampleApplies`, run
  from the published document.

## 7. End to end in Open WebUI, and documentation

- [ ] 7.1 Write `docs/openwebui.md`:
  - running the server, its configuration and the secret;
  - declaring it as a global tool server;
  - `ENABLE_FORWARD_USER_INFO_HEADERS`, what fails without it;
  - signed versus plain identity, and the size of an embed in chat storage;
  - the Open WebUI version it was checked against.

  Link it from the README. Verify: the documented commands run, and the links resolve.
- [ ] 7.2 In the local Open WebUI, drive it as a user, with a real model (Codestral or Gemini) and as
  two different users:
  - create a planning, move a milestone, show it compared to the first revision, click a milestone;
  - check that the second user cannot see the first's planning.

  Read back the stored revision files and the chat. Then a monkey pass:
  - rapid repeated updates, a stale update from a second chat;
  - a reopened chat, a server restart between create and update.

  Report what broke.
- [ ] 7.3 Write `scenario-coverage.md` with every scenario covered. Run `npm run check:scenarios` and
  `openspec validate openwebui-planning-tool-server --strict`.
