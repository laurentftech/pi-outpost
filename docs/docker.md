# Full app with Python in Docker

This recipe runs **pi-outpost itself**, including its web interface, agent and integrated terminal.
It is separate from the [Open WebUI tool-server image](openwebui.md).

Node.js, npm **12.2.2**, Python 3, pip, venv, git and curl run in the same container. The agent uses
these installed tools; it does not launch another Python container. You can build locally from a
pinned published pi-outpost package. Starting with the first release containing this recipe, the
release workflow also publishes the tested Linux x64 image to `ghcr.io/laurentftech/pi-outpost`.

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
The template explicitly sets `server.allowInsecureHttp: true` for the container-to-host
hop, which emits a plaintext warning. Existing `/data/config.json` files are preserved:
on upgrade, explicitly add that setting only if you retain the protected loopback
publication, or configure native TLS instead. Do not publish this HTTP port to public
interfaces. See [HTTPS/SSH deployment](deployment.md#remote-transport-https-or-ssh).

The port is published on loopback only. Remote access needs an authenticated TLS reverse proxy or
SSH tunnel; do not expose it by casually changing the bind address.

The terminal is enabled. Python scripts and venv creation work without agent IP networking.

**The agent's network asks you, host by host.** By default the agent's shell reaches the network only
through the server's proxy, and every host it connects to is asked about in the interface — for this
command, for the rest of the session, or refused ([grants](sandboxing.md#grants-beyond-the-sandbox-when-you-say-so)).
The image does this with `"sandbox.allowedHosts": []` in `/data/config.json`, added at startup when
the key is missing — on a fresh volume and on one from an earlier version alike. A question needs a
browser connected to the project; with none, the host is refused. To stop being asked about the hosts
you always use, list them there:

```json
{ "sandbox": { "allowedHosts": ["pypi.org", "files.pythonhosted.org"] } }
```

`ALLOW_AGENT_NETWORK` in `.env` sets the ceiling; recreate the service after changing it:

| `ALLOW_AGENT_NETWORK` | Agent's shell | Terminal |
| --- | --- | --- |
| unset (default) | through the proxy only; unlisted hosts asked about | no IP networking |
| `1` | as `/data/config.json` says: without `sandbox.allowedHosts`, open | open, listeners included |
| `0` | no IP networking at all, the proxy included | no IP networking |

None of them changes filesystem or process confinement, and the trusted server's model API requests
are separate: they work whichever you choose. With `1`, the startup leaves `/data/config.json` alone:
remove `sandbox.allowedHosts` there for an open network.

For downloads such as pip packages, the agent asks, or you list the hosts. In the terminal, which has
no questions, set `ALLOW_AGENT_NETWORK=1`, then:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install pandas
.venv/bin/python -c 'import pandas; print(pandas.__version__)'
```

The virtual environment and generated files live in the mounted project and survive container
replacement. For reproducible projects, install from your own pinned requirements file. Additional
OS libraries belong in the Dockerfile and require rebuilding the image.

For a Python web app, use `ALLOW_AGENT_NETWORK=1` and publish the chosen port on loopback in a
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
  These changes are required by landstrip 0.20.26; this is not Docker's unchanged default profile.
  Policy sources, license and changes are recorded in `deploy/docker/profiles/NOTICE.md`.
- **landstrip 0.20.26** confines both the agent's shell and the interactive terminal to `/workspace`
  and private temporary storage. The agent directory and runtime configuration are denied. A real
  canary checks each surface at startup. Any non-verified verdict refuses this recipe's startup.
  Its AppImage is extracted at build time, so running it needs neither FUSE nor an extra device.
- landstrip 0.20.26 adds a private PID namespace and procfs to filesystem confinement. Keep credentials
  separate anyway: the web token is read from a Compose secret file into protected config, and model
  credentials belong in the credential store. Do not add API keys to the service's environment.
  `PI_OUTPOST_TOKEN` is explicitly refused by this recipe.
- **By default, the agent's shell reaches only the server's proxy.** The adapter tightens the app's
  generated policy: IP connections and listeners are denied, and only the proxy's port, when the
  policy names one, stays open; a policy without it — the terminal's — has no network. The proxy
  relays the hosts `sandbox.allowedHosts` lists and asks about the others. landstrip opens that port by
  its number on every loopback address; the proxy holds it on `127.0.0.1` and `[::1]`
  ([details](sandboxing.md#linux-landstrip)). The operator's choice is recorded in protected
  `/data/agent/docker-network.json`: `ALLOW_AGENT_NETWORK=1` forwards the policy unchanged, `0`
  removes the proxy's port too. The adapter never turns a denied permission on. The native unrestricted
  IP policy (`1` without `sandbox.allowedHosts`) permits outgoing IP traffic and listeners; apply any
  additional outbound restrictions around the container.
- Extensions and MCP servers retain their process's rights. Run trusted resources only; the shell
  sandbox does not turn a shared server or malicious extension into an isolated multi-user service.

Compose secrets in this local recipe are host files mounted read-only, not an encrypted vault.
Keep `server-token` private on the host. `.dockerignore` excludes it, `.env` and project files from
the build context.

## Persistence, configuration and updates

### Use the published image

Once a release containing this recipe has completed, set these values in the recipe's `.env`,
replacing `X.Y.Z` with that release's version (the existing `0.59.1` release has no full-app image):

```dotenv
PI_OUTPOST_IMAGE=ghcr.io/laurentftech/pi-outpost
PI_OUTPOST_VERSION=X.Y.Z
```

Keep the same project, token, volume and security profiles from the setup above, then run:

```sh
docker compose pull pi-outpost
docker compose up --no-build -d
```

The published image runs as UID/GID **1000:1000**. Its mounted project must be writable and its
private token file readable by that UID. `APP_UID`/`APP_GID` customize local builds only: if you
need a different UID, keep `PI_OUTPOST_IMAGE` unset and use the local build instructions.
Published images are Linux x64 only. Every release has its exact version tag; stable releases
also update `latest`, while prereleases never move it. Prefer a version pin for controlled updates.
To update, change `PI_OUTPOST_VERSION`, pull again and recreate with `--no-build`.
For network/port changes described above, also recreate with `--no-build` when using a published
image; the `--build` commands are for the local-build setup.

### Local builds and persistent data

`PROJECT_DIR` is mounted at `/workspace`. The `pi-outpost-data` named volume keeps `/data/agent`
(credentials and conversations), `/data/config.json` and user configuration/cache directories.
Git host credentials entered in **Agent resources** are kept in `/data/agent` too. The server
user's home, `/home/node`, is **not** on the volume: a `~/.gitconfig`, `~/.git-credentials` or
`~/.ssh` written there is lost when the container is recreated — mount them, or prefer the
credential prompt (see [Git credentials for Agent resources](configuration.md#git-credentials-for-agent-resources)).
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
The test host UID must match the image UID. CI instead runs only the fixture/browser harness with
`sudo` so it can give its temporary files to UID 1000 and test the exact distributable image;
the application container remains non-root, and the token file remains mode 0600.

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
