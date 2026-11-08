# Full-app Docker recipe with Python

## Why

The published Docker image serves Open WebUI tools, not the full pi-outpost agent. Users need a
concrete way to run the app and Python together without handing the agent the Docker daemon.

## What changes

- Add a locally built, version-pinned full-app Dockerfile and Compose recipe.
- Publish the tested Linux x64 full-app image on releases, with version and stable-only latest tags.
- Install Node/npm 12, Python/venv and native terminal bindings; run as a non-root user.
- Keep project and agent state separate and persistent. Read the web token from a protected file.
- Require the existing shell and terminal canaries to verify confinement at each startup.
- Document operator-controlled agent networking, kernel requirements, credentials, upgrades and terminal use.

## Impact

New capability `docker-python-deployment`. No product protocol or default runner changes. The
release workflow hands its built CLI package to a gated full-app image job; the existing Open WebUI
image remains separate. Existing CLI doctor/canary and terminal behavior are reused. Docker behavior
is verified against the installed package, plus a browser walkthrough of the running app.
