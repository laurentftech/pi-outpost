# Full app with Python in Docker

This recipe runs **pi-outpost itself**, including its web interface, agent and integrated terminal.
It is separate from the [Open WebUI tool-server image](openwebui.md).

Node.js, npm **12.2.1**, Python 3, pip, venv, git and curl run in the same container. The agent uses
these installed tools; it does not launch another Python container. The image is built locally
from a pinned published pi-outpost package, not published automatically by the release workflow.

## Start

You need Docker with Compose v2 and a Linux kernel with Landlock enabled (5.13 or later). Docker
Desktop uses its Linux VM's kernel. Startup checks the actual runner and both confined surfaces;
an unsupported host is refused, without turning off the sandbox.

From a checkout:

```sh
cd deploy/docker
cp .env.example .env
mkdir -p workspace
umask 077
openssl rand -hex 32 > server-token
```

Edit `.env`: point `PROJECT_DIR` at an **existing** project directory. On Linux bind mounts retain
host ownership: set `APP_UID` and `APP_GID` to the output of `id -u` and `id -g`. They must be nonzero.
The project must be writable and `server-token` readable by that UID. Docker Desktop's file-sharing
ownership differs by platform; use the same UID mapping if access is refused.

```sh
docker compose up --build -d
docker compose logs -f pi-outpost
```

Open `http://127.0.0.1:3141/`, authenticate with the contents of `server-token`, then configure a model
in the setup screen. Its key is saved in `/data/agent`, not passed to commands in an environment
variable. The app is single-tenant: use a separate Compose project, data volume and token for each user.
The port is published on loopback only. Remote access needs an authenticated TLS reverse proxy or
SSH tunnel; do not expose it by casually changing the bind address.

The terminal is enabled. In its panel:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install pandas
.venv/bin/python -c 'import pandas; print(pandas.__version__)'
```

The virtual environment and generated files live in the mounted project and survive container
replacement. For reproducible projects, install from your own pinned requirements file. Additional
OS libraries belong in the Dockerfile and require rebuilding the image.

## What the boundaries mean

- The service runs as the unprivileged `node` user, with all Linux capabilities dropped,
  `no-new-privileges` and an init process. It uses Docker's default seccomp profile. There is no
  Docker socket, host networking or privileged mode.
- **landstrip 0.20.20** confines both the agent's shell and the interactive terminal to `/workspace`
  and private temporary storage. The agent directory and runtime configuration are denied. A real
  canary checks each surface at startup. Any non-verified verdict refuses this recipe's startup.
- Landlock does not hide the server's `/proc` environment from another process with the same UID.
  That is why the web token is read from a Compose secret file and stored in the protected config,
  and provider credentials belong in the credential store. Do not add API keys to the service's
  environment. `PI_OUTPOST_TOKEN` is explicitly refused by this recipe.
- **The network remains open.** This recipe does not implement a host allowlist. Apply outbound
  restrictions around the container if you need them; see [sandboxing](sandboxing.md#linux-landstrip).
- Extensions and MCP servers retain their process's rights. Run trusted resources only; the shell
  sandbox does not turn a shared server or malicious extension into an isolated multi-user service.

Compose secrets in this local recipe are host files mounted read-only, not an encrypted vault.
Keep `server-token` private on the host. `.dockerignore` excludes it, `.env` and project files from
the build context.

## Persistence, configuration and updates

`PROJECT_DIR` is mounted at `/workspace`. The `pi-outpost-data` named volume keeps `/data/agent`
(credentials and conversations), `/data/config.json` and user configuration/cache directories.
The template is copied on first start only: settings survive recreation. The token is refreshed
from the secret file on each start. To rotate it, replace `server-token` then recreate the service.

Inspect the running installation with:

```sh
docker compose exec pi-outpost pi-outpost doctor --config /data/config.json
docker compose exec pi-outpost node --version
docker compose exec pi-outpost npm --version
```

To change a setting unavailable in the interface, edit `/data/config.json` as the server user and
restart. Keep both runner paths and the project/agent directories consistent with the mounts.
Build updates into the image: change `PI_OUTPOST_VERSION` in `.env`, then run
`docker compose up --build -d` again. Do not update the global npm installation inside a running
container. `docker compose down` keeps the data volume; `down --volumes` deletes it.

## Verify the recipe

For contributors, after building the default image and installing the repository's Node dependencies
and Playwright Chromium, run from the repository root:

```sh
node deploy/docker/test.mjs
```

The test uses an isolated Compose project and fake provider credentials, exercises the installed
app's real terminal, creates a venv, executes Python, checks refused reads/writes outside the project,
interrupts a process, recreates the container to check persistence, and tests failed startup. It
removes only its own containers, volume and temporary project. It does not call a model provider.

Behind a TLS-inspecting build proxy, supply its CA as an optional BuildKit secret. Keep TLS
verification enabled; do not copy a session-specific CA into the image:

```sh
docker build --secret id=proxy_ca,src=/path/to/proxy-ca.pem -t pi-outpost-python:0.59.1 deploy/docker
```

Configure runtime proxy/CA mounts separately if the server needs them. They are deployment-specific
and are not baked into this recipe.
