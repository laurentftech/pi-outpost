# Full-app Docker recipe with Python

## Why

The published Docker image serves Open WebUI tools, not the full pi-outpost agent. Users need a
concrete way to run the app and Python together without handing the agent the Docker daemon.

## What changes

- Add a locally built, version-pinned full-app Dockerfile and Compose recipe.
- Install Node/npm 12, Python/venv and native terminal bindings; run as a non-root user.
- Keep project and agent state separate and persistent. Read the web token from a protected file.
- Require the existing shell and terminal canaries to verify confinement at each startup.
- Document the open network, kernel requirements, credential handling, upgrades and terminal use.

## Impact

New capability `docker-python-deployment`. No product protocol, default runner or release workflow
changes. Existing CLI doctor/canary and terminal behavior are reused. Docker behavior is verified
against the actual installed npm package, plus a browser walkthrough of the running app.
