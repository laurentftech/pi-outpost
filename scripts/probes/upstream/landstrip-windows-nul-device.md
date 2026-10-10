<!-- Draft issue for landstrip/landstrip (runner, Windows). Not posted. Title: -->
# Windows AppContainer: the null device (NUL) is not accessible, so Git for Windows cannot start

landstrip 0.19.11 (win32-x64), Windows 10 22H2, interactive session, `appContainerMode: "standard"`
(same in `lpac`). Inside the container the null device cannot be opened at all:

| Inside `landstrip run -- …` | Result |
|---|---|
| `cmd /c "type nul"` | `Access is denied.` |
| `cmd /c "echo x > nul"` | `Access is denied.` |
| `git --version` (Git for Windows, `Program Files\Git` allowed) | `fatal: could not open '/dev/null' for reading and writing: Permission denied` |
| `git --version < in.txt` (stdin from a file) | same |

Git for Windows opens `/dev/null` (mapped to `NUL`) at startup unconditionally, so `git` cannot run in
the sandbox at all, whatever the filesystem policy; and any script redirecting to `nul` fails too. Adding
`NUL`, `//./NUL` or `\\.\NUL` to `allowWrite` changes nothing — it is not a path the policy covers.

Policy used:

```json
{ "filesystem": { "denyRead": ["C:/"], "allowRead": ["C:/Windows", "<workspace>", "C:/Program Files/Git"], "allowWrite": ["<workspace>"] },
  "windows": { "appContainerMode": "standard" } }
```

Expected: the null device readable and writable inside the container, as it is for AppContainer apps
generally. (Run from the interactive session; over SSH other failures mask this one.)
