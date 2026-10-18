#!/usr/bin/env bash
# Seatbelt through /usr/bin/sandbox-exec, with a profile shaped like the one MXC's mxc-exec-mac
# generates (captured with --debug on Apple silicon, 2026-10-18), on any Mac — Intel included.
# The checks of the mxc-macos-seatbelt probes: reads and writes beside the root, a denied folder,
# signals to a same-user process, git (the developer tools' own), the network open (loopback
# closed) and held to a proxy port, an interactive shell on a pty.
# Usage: seatbelt-sandbox-exec.sh. Needs python3.
set -u
base=$(cd "$(mktemp -d)" && pwd -P); root=$base/app; agent=$base/agent; tmp=$base/tmp
mkdir -p "$root/sub" "$agent" "$tmp"; echo other-secret > "$base/secret.txt"; echo agent-secret > "$agent/key.txt"
dev=$(xcode-select -p 2>/dev/null); devtree=${dev%/Contents/Developer}
sleep 600 & holder=$!
profile() { # $1: network block
  cat <<P
(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow file-read-metadata)
(allow mach-lookup
    (global-name "com.apple.system.notification_center")
    (global-name "com.apple.system.logger")
    (global-name "com.apple.distributed_notifications@Uv3")
    (global-name "com.apple.CoreServices.coreservicesd")
    (global-name "com.apple.FSEvents"))
(allow file-read-data (literal "/"))
(allow file-read*
    (subpath "/bin") (subpath "/sbin") (subpath "/usr") (subpath "/System") (subpath "/Library")
    (subpath "/private/var/db/timezone") (subpath "/private/var/db/dyld") (subpath "/private/var/select")
    (subpath "/private/etc") (subpath "/private/var/db/xcode_select_link") (subpath "$devtree"))
(allow file-read* file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom"))
(allow file-read* file-write* file-ioctl (literal "/dev/tty") (regex #"^/dev/ttys[0-9]+\$"))
(allow file-read* (subpath "/dev/fd"))
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write* (subpath "$root") (subpath "$tmp"))
$1
(deny mach-lookup (global-name "com.apple.windowserver.active") (global-name "com.apple.windowserver.session") (global-name "com.apple.coreservices.launchservicesd") (global-name "com.apple.pasteboard.1"))
(deny iokit-open (iokit-user-client-class "IOHIDLibUserClient"))
(deny file-read* file-read-metadata file-write* (subpath "$agent"))
P
}
OPEN='(allow network-outbound) (allow network-bind (local ip)) (allow system-socket) (deny network-outbound (remote ip "localhost:*"))'
run() { # $1 network block, $2 command
  profile "$1" > "$base/profile.sb"
  # Started in the root, as pi-outpost spawns it: a starting directory outside it is unreadable.
  (cd "$root" && env -i PATH="$dev/usr/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$root" TMPDIR="$tmp/" TERM=xterm-256color \
    /usr/bin/sandbox-exec -f "$base/profile.sb" /bin/bash -c "$2"); echo "[rc=$?]"
}
echo "macOS $(sw_vers -productVersion) $(uname -m); developer dir $dev"
echo "== filesystem, signals, key, git"
export PROBE_SERVER_SECRET=sk-server-secret
run "$OPEN" "cat $base/secret.txt; echo sibling=\$?; cat $agent/key.txt; echo agent=\$?; ls $agent >/dev/null 2>&1; echo list-agent=\$?; echo in > in.txt; echo out > $base/out.txt; echo beside=\$?; kill -0 $holder; echo signal=\$?; env | grep -c PROBE_SERVER_SECRET; ps -A >/dev/null 2>&1; echo ps=\$?; command -v git; git init -q . && git status --short --branch 2>&1"
echo "host: in.txt=$(cat "$root/in.txt" 2>/dev/null) out.txt=$(cat "$base/out.txt" 2>/dev/null || echo absent) holder=$(kill -0 $holder 2>/dev/null && echo alive || echo GONE) root=$(ls -A "$root" | tr '\n' ' ')"
python3 -u -m http.server 0 --bind 127.0.0.1 --directory "$base" > "$base/other.log" 2>&1 & other=$!; sleep 1
otherport=$(grep -o 'port [0-9]*' "$base/other.log" | head -1 | cut -d' ' -f2)
echo "== network open, loopback closed"
run "$OPEN" "curl -s -o /dev/null -m 10 -w 'example=%{http_code}\n' https://example.com/; curl -s -m 5 http://127.0.0.1:$otherport/ >/dev/null; echo loopback=\$?"
echo "== network closed but for one loopback port ($otherport, standing for the proxy)"
run "(allow network-outbound (remote ip \"localhost:$otherport\"))" "curl -s -o /dev/null -m 10 https://example.com/; echo direct=\$?; curl -s -o /dev/null -m 5 -w 'proxy-port=%{http_code}\n' http://127.0.0.1:$otherport/"
echo "== interactive bash on a pty"
profile "$OPEN" > "$base/profile.sb"
{ sleep 1; echo 'stty size; cd sub; pwd'; sleep 1; echo 'sleep 30'; sleep 1; printf '\003'; sleep 1; echo 'echo after=$?'; sleep 1; echo exit; } \
  | (cd "$root" && script -q /dev/null bash -c "stty rows 40 cols 120; exec env -i PATH=/usr/bin:/bin HOME='$root' TERM=xterm /usr/bin/sandbox-exec -f '$base/profile.sb' /bin/bash --norc -i") | tr -d '\r' | grep -v '^\s*$' | tail -8
kill $holder $other 2>/dev/null; rm -rf "$base"
