# Scenario coverage

Scenarios enumerated with:

```sh
rg '^#### Scenario:' openspec/changes/add-doctor-command/specs/
```

Two kinds of citation appear below. Where a scenario is a claim about *what the report
says*, the check's own unit test is cited: those functions are pure over an injected
`Diagnosis`, so a test can produce a Windows path layout or an occupied port without
arranging one. Where a scenario is a claim about *the command running at all* — the one
property that lives in `index.ts`'s ordering and nowhere else — the citation is the CLI
driven as a child process in a real directory.

| Spec scenario | State | Test and contract assertion |
|---|---|---|
| `cli / DoctorAnswersWhereAStartRefuses` | covered | `server/test/config-cli.test.mjs` — “reports a directory with no configuration instead of refusing like every other command” runs the real CLI in an empty directory with its own `XDG_CONFIG_HOME`: asserts exit 1, that a report was produced at all (`[ok  ] installation`), that `[FAIL] configuration` names both candidate paths, that both forms of `init` are offered, and that the global-install sentence is present. Were `doctor` wired after `loadConfig`, the process would exit before printing any of it and every assertion would fail. `server/test/doctor.test.ts` — “a directory with no configuration anywhere fails, and names both files init would write” asserts the same content over the injected `NoConfigError`. |
| `cli / DoctorNamesTheConfigurationAStartWouldRead` | covered | `server/test/doctor.test.ts` — “the chosen file is marked in the search order, so a shadowed candidate is visible” asserts exactly one `→` marker, on the chosen path, with the unread candidate still listed; “an explicitly named file says the search never ran, rather than listing it” asserts no marker is emitted for a search that did not happen. `server/test/config-cli.test.mjs` — “names the file a start would read, and the settings it would run with” asserts the marker against a real file on disk. “the candidates reported are the ones findConfigFile actually searches” writes each candidate in turn and asserts `findConfigFile` returns that exact path, so the reported list cannot drift from the performed search. |
| `cli / DoctorEchoesAMissingNamedConfig` | covered | `server/test/config-cli.test.mjs` — “a --config that does not exist is reported as the path that was typed” asserts exit 1 and the exact path in the output. `server/test/doctor.test.ts` — “a named file that is missing fails with the resolver's own message” asserts the resolver's message is carried rather than reworded. |
| `cli / DoctorReportsEveryProblemInOneRun` | covered | `server/test/doctor.test.ts` — “every check still runs after the configuration failed” breaks the configuration, the web UI and git at once and asserts all four checks are present with two failures. `server/test/config-cli.test.mjs` — the no-configuration case asserts `web UI` and `git` still appear after `[FAIL] configuration`. |
| `cli / DoctorNamesWhatHoldsTheAddress` | covered | `server/test/doctor.test.ts` — “a free port is reported as bindable”, “another pi-outpost holding the port is a warning that points at it” (asserts `warn`, the URL, and `--port`), “a foreign service holding the port fails, because starting here cannot work” (asserts `fail` and `EADDRINUSE`). The probe itself is proved against real sockets: “a closed port is not listening”, “a server answering /health like this one is recognised”, “the startup stub's 503 still identifies this server”, “a foreign HTTP service is listening but is not this one”, and “a socket that accepts and never answers counts as taken, not as free” — the last one would otherwise report a busy port as free. |
| `cli / DoctorReportsAnInstallationWithNoInterface` | covered | `server/test/doctor.test.ts` — “no interface anywhere fails, and says the server would answer 404 rather than refuse” asserts `fail`, the `404`, and that the searched directories are named; “a checkout is told to build, an installation is told to reinstall” asserts the two remedies differ by install channel; “a disk build is reported by the directory that answered” asserts the *second* candidate is the one reported when only it carries an `index.html`. |
| `cli / DoctorNeverEchoesTheToken` | covered | `server/test/doctor.test.ts` — “a token is reported as set and never echoed” asserts `auth token: set` **and** that the literal value is absent from the whole rendered check. |
| `cli / DoctorExitCodeMarksABlockedServer` | covered | `server/test/doctor.test.ts` — “a failure is a non-zero exit, so a script can trust the command” and “warnings alone exit zero, because nothing is stopping the server” assert both directions. The end-to-end exit 1 is asserted twice in `server/test/config-cli.test.mjs`. |

## Not covered here, deliberately

- **The `installation` line's own accuracy on each install shape.** `installationCheck` is
  asserted over all five channels, but `detectChannel` deciding which one a given machine
  is remains covered by `server/test/update.test.ts`, where it already was. This change
  reuses that rule rather than restating it, so it adds no new claim to prove.
- **A machine that genuinely lacks git or `node-pty`.** Both are injected in the unit
  tests, and both produce warnings rather than failures. Arranging a host without git to
  prove a warning would test the host, not the report.
