## 1. Withhold unconfined built-ins

- [x] 1.1 Reproduce over a real server: an extension calling `setActiveTools` with `bash` activates Pi's unconfined `bash` and `powershell` in a sandbox without `allowBash`; a read-only sandbox registers Pi's `write` and `edit`.
- [x] 1.2 Exclude the built-ins the sandbox does not supply from the session's registry (spec: UnconfinedBuiltInsAreNotRegistered).
- [x] 1.3 Refuse a sandboxed session that still registers a Pi built-in.
