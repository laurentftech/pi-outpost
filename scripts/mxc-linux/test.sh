#!/usr/bin/env bash
# MXC's Linux executor, tested where it would run: a Docker container.
#
# Twice. Under Docker's default profile, the runner must be refused with MXC's reason. With the
# flags docs/sandboxing.md documents, every limit is checked from inside a confined command and
# terminal. Builds from the working tree: tracked files, and new ones under server/ and scripts/
# only — a checkout's stray files (keys, executables) stay out of the image.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

image=pi-outpost-mxc-linux-test
{ git ls-files -z --cached; git ls-files -z --others --exclude-standard -- server scripts; } \
  | tar --null -cf - -T - \
  | docker build -q -t "$image" -f scripts/mxc-linux/Dockerfile - >/dev/null

echo "== Docker's default profile: MXC must refuse, saying why"
docker run --rm -e MXC_LINUX_EXPECT=refused "$image"

echo "== The documented flags: confined"
docker run --rm -e MXC_LINUX_EXPECT=confined \
  --security-opt seccomp=unconfined --security-opt apparmor=unconfined \
  --security-opt systempaths=unconfined \
  --security-opt no-new-privileges --device /dev/net/tun \
  "$image"
