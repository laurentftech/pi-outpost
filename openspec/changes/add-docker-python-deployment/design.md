# Design

OpenLore orient identified CLI/configuration, terminalSandbox, confinementStatus and doctor as the
existing boundaries. The Open WebUI image is a different server and is not an appropriate base.
The existing specs require missing confinement to refuse commands and terminal startup. The recipe
adds a stricter deployment gate: both actual doctor canaries must report verified before serving.

Build locally from pinned npm packages, keeping make/g++ for Python's native dependencies. The first
real CI run disproved the assumption that current landstrip works under Docker's default profile:
0.20.20 requires user/PID/mount namespaces and private procfs. Supply a Docker-derived default-deny
seccomp profile permitting only its exact clone flags and two mount flags, and an AppArmor profile
permitting those mounts and userns while keeping protected proc/sys paths. Unmasking system paths is
also necessary for the private proc mount. Do not change host-wide userns restrictions. No Docker
socket, privileged mode, extra capabilities or host networking. This does not restrict networking.

The app and Python share the image; Python venvs belong to the project bind mount. A separate
named volume holds credentials, conversations and runtime config. The config template is used only
for first startup, with the web token refreshed from a Compose secret file each time. Credentials
stay out of the server environment even with landstrip's private procfs. User authentication
and provider configuration otherwise use the existing app, with no new product flow.

The image is a recipe, not a new automatically published release artifact. The existing release
pipeline and its Open WebUI image remain outside this change's implementation scope.
