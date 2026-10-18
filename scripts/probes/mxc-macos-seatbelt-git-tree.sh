#!/usr/bin/env bash
# Fourth round on mxc-exec-mac (Seatbelt): (1) does the real git — the developer directory's, not
# /usr/bin/git, Apple's xcrun shim — run quietly in the sandbox and leave nothing in HOME? (2) which
# processes sit between the executor and an interactive shell, and does lsof read the shell's cwd?
# Usage: mxc-macos-seatbelt-git-tree.sh <path to mxc-exec-mac>
set -u
X=$1
base=$(cd "$(mktemp -d)" && pwd -P); root=$base/app; tmp=$base/tmp; mkdir -p "$root/sub" "$tmp"
dev=$(xcode-select -p)
for d in "$dev/usr/bin" "$dev/Toolchains/XcodeDefault.xctoolchain/usr/bin"; do [ -x "$d/git" ] && gitdir=$d && break; done
echo "developer dir: $dev; real git in: ${gitdir:-none}"
req() {
  cat > "$base/req.json" <<J
{"version":"1.0.0","containment":"seatbelt","process":{"commandLine":$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),"cwd":"$root","env":["PATH=$gitdir:/usr/bin:/bin:/usr/sbin:/sbin","HOME=$root","TMPDIR=$tmp/","TERM=xterm-256color"]},
 "filesystem":{"readwritePaths":["$root","$tmp"],"readonlyPaths":["/usr","/bin","/sbin","/System","/Library","/private/etc","/private/var/db/xcode_select_link","${dev%/Contents/Developer}"]},"network":{"egress":{"default":"allow"}}}
J
}
echo "== real git"
req "command -v git; git --version; git init -q . && git rev-parse --is-inside-work-tree; git status --short --branch"
"$X" "$base/req.json" 2>&1; echo "[rc=$?] root holds: $(ls -A "$root" | tr '\n' ' ')"
echo "== process tree under the executor, shell in sub/"
req "/bin/bash --norc -i"
{ sleep 1; echo 'cd sub'; sleep 4; echo exit; } | script -q /dev/null bash -c "exec '$X' '$base/req.json'" >/dev/null 2>&1 &
sleep 3
exe=$(pgrep -f "mxc-exec-mac $base/req.json" | head -1)
walk() { local p=$1 d=$2; for c in $(pgrep -P "$p"); do printf '%*s%s %s cwd=%s\n' "$d" '' "$c" "$(ps -o comm= -p "$c")" "$(lsof -a -p "$c" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"; walk "$c" $((d+2)); done; }
echo "$exe $(ps -o comm= -p "$exe")"; walk "$exe" 2
wait; rm -rf "$base"
