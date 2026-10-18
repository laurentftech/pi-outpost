#!/usr/bin/env bash
# MXC's macOS executor (mxc-exec-mac, Seatbelt), measured with the checks the Linux runner passes:
# reads beside the root and in an agent directory, writes in and beside the root, the processes and
# environments a command sees, git, the network open and closed, and a pty.
# Usage: mxc-macos-seatbelt.sh <path to mxc-exec-mac>. Everything lives in a temporary folder.
set -u
X=$1
base=$(cd "$(mktemp -d)" && pwd -P); root=$base/app; agent=$base/agent
mkdir -p "$root" "$agent"; echo other-secret > "$base/secret.txt"; echo agent-secret > "$agent/key.txt"
export PROBE_SERVER_SECRET=sk-server-secret
sleep 600 & holder=$!   # a process of the same user holding a secret in its environment
req() { # $1 command line, $2 network JSON (may be empty)
  cat > "$base/req.json" <<J
{"version":"1.0.0","containment":"seatbelt","process":{"commandLine":$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),"cwd":"$root","env":["PATH=/usr/bin:/bin:/usr/sbin:/sbin","HOME=$root"]},
 "filesystem":{"readwritePaths":["$root"],"readonlyPaths":["/usr","/bin","/sbin","/System","/Library","/private/etc","/opt/homebrew"],"deniedPaths":["$agent"]}$2}
J
  "$X" "$base/req.json"; echo "[rc=$?]"
}
echo "== filesystem, processes, git (network open)"
req "cat $base/secret.txt; echo sibling=\$?; cat $agent/key.txt; echo agent=\$?; echo in > in.txt; echo inside=\$?; echo out > $base/out.txt; echo beside=\$?; ls / >/dev/null; echo ls-root=\$?; echo procs=\$(ps -ax | wc -l); echo holder-env=\$(ps -E -p $holder -o command= 2>/dev/null | grep -c sk-server-secret); env | grep -c PROBE_SERVER_SECRET; git init -q . && git rev-parse --is-inside-work-tree" ',"network":{"egress":{"default":"allow"}}'
echo "host: in.txt=$(cat "$root/in.txt" 2>/dev/null) out.txt=$(cat "$base/out.txt" 2>/dev/null || echo absent)"
echo "== network open"
req "curl -s -o /dev/null -m 10 -w 'example=%{http_code}\n' https://example.com/" ',"network":{"egress":{"default":"allow"}}'
echo "== network closed"
req "curl -s -o /dev/null -m 10 -w 'example=%{http_code}\n' https://example.com/; echo curl=\$?" ',"network":{"egress":{"default":"deny"}}'
echo "== no network field"
req "curl -s -o /dev/null -m 10 -w 'example=%{http_code}\n' https://example.com/; echo curl=\$?" ''
echo "== pty (script): size and tty"
req "stty size; tty" ',"network":{"egress":{"default":"allow"}}' < /dev/null
script -q /dev/null bash -c "stty rows 40 cols 120; '$X' '$base/req.json'" < /dev/null | tr -d '\r'
kill $holder; rm -rf "$base"
