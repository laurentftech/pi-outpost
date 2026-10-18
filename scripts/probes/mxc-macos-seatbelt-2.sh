#!/usr/bin/env bash
# Second round on mxc-exec-mac (Seatbelt): can a confined command signal a process of the same user
# (the server)? Does git run with the developer tools readable? Does an interactive bash work when
# the executor itself sits on a pty, as pi-outpost's terminal spawns it?
# Usage: mxc-macos-seatbelt-2.sh <path to mxc-exec-mac>
set -u
X=$1
base=$(cd "$(mktemp -d)" && pwd -P); root=$base/app; mkdir -p "$root"
dev=$(xcode-select -p 2>/dev/null); dev=${dev%/Contents/Developer}
sleep 600 & holder=$!
req() {
  cat > "$base/req.json" <<J
{"version":"1.0.0","containment":"seatbelt","process":{"commandLine":$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),"cwd":"$root","env":["PATH=/usr/bin:/bin:/usr/sbin:/sbin","HOME=$root","TERM=xterm-256color"]},
 "filesystem":{"readwritePaths":["$root"],"readonlyPaths":["/usr","/bin","/sbin","/System","/Library","/private/etc","/private/var/db/xcode_select_link","$dev"]},"network":{"egress":{"default":"allow"}}}
J
}
echo "developer dir: $dev"
echo "== signals to a same-user process ($holder)"
req "kill -0 $holder; echo kill0=\$?; kill -TERM $holder; echo term=\$?"; "$X" "$base/req.json"
kill -0 $holder 2>/dev/null && echo "host: holder alive" || echo "host: holder KILLED"
echo "== git"
req "git --version; git init -q . && git rev-parse --is-inside-work-tree; git status --short --branch"; "$X" "$base/req.json"
echo "== interactive bash on a pty"
req "/bin/bash --norc -i"
{ sleep 1; echo 'stty size; tty; echo pid=$$; cd /; echo cd=$?; pwd'; sleep 1; echo 'sleep 30'; sleep 1; printf '\003'; sleep 1; echo 'echo after=$?'; sleep 1; echo exit; } \
  | script -q /dev/null bash -c "stty rows 40 cols 120; exec '$X' '$base/req.json'" | tr -d '\r' | grep -v '^\s*$'
kill $holder 2>/dev/null; rm -rf "$base"
