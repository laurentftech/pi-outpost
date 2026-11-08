# Docker policy provenance

The seccomp baseline and AppArmor profile are derived from Moby profiles, commit 4b8214fc4971e06172938a1f1554ccff6647ee80:
https://github.com/moby/profiles/tree/4b8214fc4971e06172938a1f1554ccff6647ee80

Copyright The Moby Authors. Apache-2.0; see LICENSE in this directory.

Changes for landstrip 0.20.20 (unchanged for 0.20.26, checked by deploy/docker/test.mjs):
- Seccomp keeps the upstream default-deny policy. It adds the exact clone flags used for user/PID/mount namespaces, two mount flag combinations (private propagation and nosuid/nodev/noexec procfs), and pidfd_getfd with flags 0 for the native socket broker. Kernel ptrace checks still apply; CAP_SYS_PTRACE is not granted.
- AppArmor keeps the upstream protected proc/sys paths and peer signal/ptrace rules, uses ABI 4.0 with explicit Unix networking, and permits user namespaces and these two mounts instead of denying all mounts.
- Compose separately unmasks system paths so a user namespace can mount its private procfs. No Linux capability is added. These are explicit Docker policy exceptions; this recipe does not use Docker's unchanged default profile.
