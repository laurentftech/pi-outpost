# Full app with Python in Docker

This recipe runs **pi-outpost itself**, including its web interface, agent and integrated terminal.
It is separate from the [Open WebUI tool-server image](openwebui.md).

Node.js, npm **12.2.1**, Python 3, pip, venv, git and curl run in the same container. The agent uses
these installed tools; it does not launch another Python container. The image is built locally
from a pinned published pi-outpost package, not published automatically by the release workflow.

## Start

You need Docker with Compose v2 and a Linux kernel with Landlock and user namespaces enabled.
Docker Desktop uses its Linux VM's kernel. Linux hosts with AppArmor need AppArmor 4 and the dedicated
profile below. Startup checks the actual runner and both confined surfaces;
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

On a Linux host with AppArmor, load the supplied profile, then set
`LANDSTRIP_APPARMOR_PROFILE=pi-outpost-landstrip` in `.env`:

```sh
sudo apparmor_parser -r profiles/pi-outpost-landstrip.apparmor
```

This grants user namespaces to this profile without changing the host-wide
`kernel.apparmor_restrict_unprivileged_userns` setting. A host administrator must load the profile
again after reboot, or install it in the host's normal persistent AppArmor profile directory.
Docker Desktop hosts without AppArmor keep `LANDSTRIP_APPARMOR_PROFILE=unconfined`.

```sh
docker compose up --build -d
docker compose logs -f pi-outpost
```

Open `http://127.0.0.1:3141/`, authenticate with the contents of `server-token`, then configure a model
in the setup screen. Its key is saved in `/data/agent`, not passed to commands in an environment
variable. The app is single-tenant: use a separate Compose project, data volume and token for each user.
The port is published on loopback only. Remote access needs an authenticated TLS reverse proxy or
SSH tunnel; do not expose it by casually changing the bind address.

The terminal is enabled. Python scripts and venv creation work without agent IP networking.
For downloads such as pip packages, set `ALLOW_AGENT_NETWORK=1` in `.env`, then recreate the service
with `docker compose up --build -d`. This permits IP connections and listeners inside the container
subject to the caller's policy. It does not change filesystem or process confinement.
The trusted server's model API requests are separate and work with this option off.

With that explicit network opt-in, in the terminal:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install pandas
.venv/bin/python -c 'import pandas; print(pandas.__version__)'
```

The virtual environment and generated files live in the mounted project and survive container
replacement. For reproducible projects, install from your own pinned requirements file. Additional
OS libraries belong in the Dockerfile and require rebuilding the image.

For a Python web app, use that same explicit network opt-in and publish the chosen port on loopback in a
`compose.override.yml` beside the recipe, for example:

```yaml
services:
  pi-outpost:
    ports:
      - "127.0.0.1:8000:8000"
```

Recreate the service with `docker compose up --build -d`, then start
the Python app from the terminal listening on `0.0.0.0:8000` inside the container.
For a simple file server: `python3 -m http.server 8000 --bind 0.0.0.0`. Open
`http://127.0.0.1:8000/` on the host. This additional app has its own authentication requirements;
the pi-outpost access token does not protect it. No Docker socket is needed.

The app, agent and Python run in one container. Docker publishes only the host ports the operator
chooses; there is no relay service or access to the Docker daemon.

## What the boundaries mean

- The service runs as the unprivileged `node` user, with all Linux capabilities dropped,
  `no-new-privileges` and an init process. There is no Docker socket, host networking or privileged mode.
- **The Docker profile has explicit exceptions.** The supplied seccomp profile keeps Docker's
  default-deny baseline and allows landstrip's exact clone flags, two mount flag combinations and
  `pidfd_getfd` with flags 0 so its broker can inspect a tracee socket. Kernel ptrace checks still
  apply; no `CAP_SYS_PTRACE` is added.
  The AppArmor profile permits user namespaces and the two mounts while retaining Docker's protected
  proc/sys paths. Compose also unmasks system paths so the child can mount its private procfs.
  These changes are required by landstrip 0.20.20; this is not Docker's unchanged default profile.
  Policy sources, license and changes are recorded in `deploy/docker/profiles/NOTICE.md`.
- **landstrip 0.20.20** confines both the agent's shell and the interactive terminal to `/workspace`
  and private temporary storage. The agent directory and runtime configuration are denied. A real
  canary checks each surface at startup. Any non-verified verdict refuses this recipe's startup.
  Its AppImage is extracted at build time, so running it needs neither FUSE nor an extra device.
- landstrip 0.20.20 adds a private PID namespace and procfs to filesystem confinement. Keep credentials
  separate anyway: the web token is read from a Compose secret file into protected config, and model
  credentials belong in the credential store. Do not add API keys to the service's environment.
  `PI_OUTPOST_TOKEN` is explicitly refused by this recipe.
- **IP networking in the agent's shell and terminal is disabled by default.** The adapter tightens the app's generated
  policy to deny IP connections and listeners. Only the operator can opt in with
  `ALLOW_AGENT_NETWORK=1`; the choice is recorded in protected `/data/agent/docker-network.json`.
  With that opt-in, the adapter forwards the caller's policy unchanged; it never turns a denied
  permission on. An explicit restricted network policy remains restricted. The native unrestricted
  IP policy permits both outgoing IP traffic and listeners; it is not a host allowlist.
  Apply any additional outbound restrictions around the container.
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

The automated container and browser checks run on GitHub's Ubuntu x64 runner with AppArmor 4.
ARM64 and Docker Desktop builds are not covered by this workflow; the startup probes remain
mandatory on those hosts too.

For contributors, after building the default image and installing the repository's Node dependencies
and Playwright Chromium, run from the repository root:

```sh
node deploy/docker/test.mjs
```

On an AppArmor host, set `LANDSTRIP_APPARMOR_PROFILE=pi-outpost-landstrip` for that test command
too; it uses an isolated temporary Compose project rather than the recipe's `.env` file.

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
