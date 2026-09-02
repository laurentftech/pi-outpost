## 1. Authoritative Readiness Model

- [x] 1.1 Add a shared, pure Work Plan review-readiness predicate covering empty plans, all terminal/review plans, and mixed `todo`, `in_progress`, or `blocked` plans; verify its focused unit tests pass.
- [x] 1.2 Extend the typed workspace activity protocol with `ready-for-review` and generic attention semantics; verify shared and downstream TypeScript builds reject no exhaustive consumer.
- [x] 1.3 Update product-owned Work Plan guidance so agents explicitly reconcile review work and acknowledgement transitions; verify focused system-prompt and Work Plan contract tests assert the new guidance without changing plan persistence version 1.

## 2. Server Activity Projection

- [x] 2.1 Derive `ready-for-review` from the synchronized, session-matched authoritative Work Plan using the specified precedence over idle but below starting, stopped, waiting, and working; verify focused server tests cover every precedence branch and prove turn/tool completion alone cannot create readiness.
- [x] 2.2 Announce workspace activity after accepted Work Plan synchronization and keep selection/session binding read-only with respect to review readiness; verify multi-client integration tests observe enter, persist-across-switch, acknowledge, resume, and return-to-ready transitions.
- [x] 2.3 Exempt review-ready workspaces from idle retirement while preserving retirement for ordinary idle workspaces; verify the retirement integration tests cover both outcomes.
- [x] 2.4 Prove cross-workspace isolation and concurrency with integration tests where several background workspaces are simultaneously ready and summaries contain no Work Plan or workspace content; run `npm run test --workspace server`.

## 3. Selector and Notifications

- [x] 3.1 Add an accessible, non-colour-only `ready for review` mark and label to every selector presentation, counting ready and waiting workspaces through the existing attention affordance; verify `ProjectMenu` component tests cover active, background, mixed, and multiple-ready states.
- [x] 3.2 Extend browser notifications to produce one generic review-specific notification per newly ready background workspace, without plan-derived text and without clearing on selection; verify `useWorkspaceNotifications` tests cover visibility, permission, deduplication, isolation wording, transitions, and multiple workspaces.
- [x] 3.3 Run `npm run test --workspace ui`, `npm run typecheck`, and `npm run build` to verify protocol and UI integration across all packages.

## 4. Running-App and Contract Verification

- [x] 4.1 Seed or drive a real multi-workspace session into review readiness and add Playwright coverage that checks selector DOM state, switching persistence, simultaneous ready workspaces, and absence of cross-workspace content; run `npm run test:e2e`.
- [x] 4.2 Enumerate every applicable main and delta `#### Scenario:` with `rg '^#### Scenario:' openspec/`, produce a scenario-to-test matrix with assertion-level `covered` evidence, and run `openspec validate add-workspace-ready-for-review --strict`.

## 5. Documentation Impact

- [x] 5.1 Review all affected user and developer documentation for Work Plan status, multi-workspace activity, selector states, notifications, privacy, and test workflows; update `README.md`, `docs/design/multi-project-selector/README.md` and any other affected README or guide, then verify links, commands, terminology, and the selector design artifact inventory.
- [x] 5.2 Add a `Documentation impact` section to the implementation PR description listing the updated files and validation performed; verify it matches the final diff before opening or updating the PR.
