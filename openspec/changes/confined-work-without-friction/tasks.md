# Tasks

## 1. What stood between the agent and the work

- [x] 1.1 A default timeout for a confined command given none (300 s), ending with a sentence that says why and what to do, and nothing about the sandbox. Verify with `server/test/confinedBash.test.ts`, "ACommandGivenNoTimeoutStillEnds".
- [x] 1.2 PowerShell's module cache in the command's private temporary directory (`PSModuleAnalysisCachePath`), for the agent's shell and the confined terminal. Verify under real MXC, failing without the fix (`PowerShellLeavesNothingInTheProject`).
- [x] 1.3 Python's output in UTF-8 under MXC on Windows (`PYTHONIOENCODING`). Verify under real MXC, failing without the fix (`PythonsMessagesComeBackUndamaged`).
- [x] 1.4 A grant request for what the sandbox already gives is not refused for holding a protected file. Verify with `server/test/sandboxGrants.test.ts` and the existing refusals.

## 2. The real-agent scenarios

- [x] 2.1 `server/scripts/agent-scenarios.mts`: the `pi-outpost init` configuration on this machine's runner; a secret beside the project and a copy of the user's keys in a throwaway agent directory; the sandbox's questions answered by a fixed rule; the result checked from outside the sandbox; the secret asked for outright; tool calls, failures, every `[pi-outpost]` note, questions and leaks reported. `--pace` spaces requests for a rate-limited model (`agent-scenario-pace.mjs`).
- [x] 2.2 Python (FastAPI, uv, pytest) with Mistral's codestral, run until no note misled the model. Found and fixed here and in `durable-sandbox-rules`: the note about the sandbox after a failure the sandbox had nothing to do with (the model asked for grants in a loop), the refusal of the project's own root, the command that never ended, PowerShell's cache in the project, Python's damaged messages. Left to the model: its own import error, which it did not solve. Not fixed: `uvicorn --reload` under MXC — its reloader's child cannot open the parent's named pipe (`WaitNamedPipe` → `[WinError 2]`); `multiprocessing` itself and `uvicorn` without `--reload` work. For the MXC issue.
- [ ] 2.3 TypeScript (Node, npm, tests, a CLI) with codestral, once.

## 3. Documentation

- [x] 3.1 `docs/sandboxing.md`: the default timeout, `uvicorn --reload` under MXC, the module cache and Python's encoding.
