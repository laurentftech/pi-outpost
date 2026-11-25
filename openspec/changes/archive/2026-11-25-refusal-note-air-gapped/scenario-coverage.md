# Scenario coverage: refusal-note-air-gapped

| Scenario | Status | Test |
| --- | --- | --- |
| ASandboxRefusalIsNamed | covered | `server/test/socketRefused.test.ts`, "ASandboxRefusalIsNamed: WSAEACCES, as programs word it, is recognised; other failures are not" and "the note says what refused it, not to retry, and what this sandbox closes" (named-host and proxy assertions); `server/test/sandboxNetworkVerdict.test.ts:44` (named-host note text, unchanged); real MXC: `server/test/windowsSandboxReachMxc.test.ts`, "ASandboxRefusalIsNamed: …" |
| TheNoHostRefusalNoteDoesNotClaimTheInternetIsOpen | covered | `server/test/socketRefused.test.ts`, "the note says what refused it, not to retry, and what this sandbox closes": the no-host note matches `a network connection was refused (WSAEACCES, 10013)`, does not match `the Internet is open`, matches the air-gapped/firewall and outbound-unrestricted wordings and `retrying will not help`; the proxy shape keeps `the sandbox refused a network connection (a direct one: no route but the proxy)` |
