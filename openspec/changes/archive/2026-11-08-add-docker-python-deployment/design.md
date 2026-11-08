# Design

OpenLore orient identified CLI/configuration, terminalSandbox, confinementStatus and doctor as the
existing boundaries. The Open WebUI image is a different server and is not an appropriate base.
The existing specs require missing confinement to refuse commands and terminal startup. The recipe
adds a stricter deployment gate: both actual doctor canaries must report verified before serving.

Build locally from pinned npm packages, keeping make/g++ for Python's native dependencies. The first
real CI run disproved the assumption that current landstrip works under Docker's default profile:
0.20.20 requires user/PID/mount namespaces and private procfs. Supply a Docker-derived default-deny
seccomp profile permitting its exact clone flags, two mount flags and pidfd_getfd flags 0, and an AppArmor profile
permitting those mounts and userns while keeping protected proc/sys paths. Unmasking system paths is
also necessary for the private proc mount. Do not change host-wide userns restrictions. No Docker
socket, privileged mode, extra capabilities or host networking.

The native socket broker duplicates the tracee's socket with pidfd_getfd. Docker's baseline blocks
that syscall without CAP_SYS_PTRACE; permitting the syscall with flags 0 lets the broker enforce
the existing native network policy, while kernel ptrace checks still apply and no capability is added.
Native policy resolution confirms allowNetwork true is unrestricted IP networking; allowLocalBinding
is a narrower option in restricted mode, not a separate refusal when IP access is unrestricted.

The deployment adapter never enlarges a caller policy. By default it tightens the app's generated
single-file policy to deny IP connections and local binding. Explicit operator ALLOW_AGENT_NETWORK=1,
stored in the protected agent directory, only forwards the original policy unchanged. A caller's
explicit restricted network policy therefore remains restricted. Actual bind/connect probes check
both the default ceiling and the explicit caller refusal. Python HTTP through a host-loopback port
is tested only after the operator opt-in; filesystem protection is rechecked in that mode.

The app and Python share the image; Python venvs belong to the project bind mount. A separate
named volume holds credentials, conversations and runtime config. The config template is used only
for first startup, with the web token refreshed from a Compose secret file each time. Credentials
stay out of the server environment even with landstrip's private procfs. User authentication
and provider configuration otherwise use the existing app, with no new product flow.

The user's follow-up extends the recipe to automatic GHCR publication. After successful npm
publication, the release job packs the already built CLI without rerunning lifecycle scripts and
passes it as an internal artifact. The full-app image installs that tarball, asserts its exact
version, and runs all confinement and browser checks before tagging/pushing the same image.
This avoids the observed npm registry propagation delay. The attachment job filters public
artifacts so the internal tarball is not accidentally uploaded to GitHub Releases.
The image uses UID/GID 1000, including during tests; only CI's temporary fixture harness runs
as root to chown its own files, including the mode-0600 token. The app remains non-root.
Reuse image-tags.mjs so prereleases cannot move latest. Publish only tested Linux x64 initially.
Anonymous manifest inspection gates completion and exposes first-publish visibility problems.
The existing Open WebUI image remains separate and its build is unchanged.
