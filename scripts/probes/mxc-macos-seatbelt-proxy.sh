#!/usr/bin/env bash
# Third round on mxc-exec-mac (Seatbelt): the shape sandbox.allowedHosts uses — egress denied, inbound
# denied, runtimeConfig.networkProxy at a CONNECT proxy on the loopback that relays one host only.
# Does the command reach the listed host through the proxy, and nothing else (unlisted host, the
# listed host ignoring the proxy, another loopback service)? Also tries ingress "allow" beside the
# proxy, which Bubblewrap refuses and Windows needs.
# Usage: mxc-macos-seatbelt-proxy.sh <path to mxc-exec-mac>. Needs python3 only.
set -u
X=$1
base=$(cd "$(mktemp -d)" && pwd -P); root=$base/app; mkdir -p "$root"
cat > "$base/proxy.py" <<'PY'
import socket, sys, threading
ALLOWED = {"registry.npmjs.org"}
srv = socket.socket(); srv.bind(("127.0.0.1", 0)); srv.listen(16)
print(srv.getsockname()[1], flush=True)
def pipe(a, b):
    try:
        while (d := a.recv(65536)): b.sendall(d)
    except OSError: pass
    finally:
        for s in (a, b):
            try: s.shutdown(socket.SHUT_RDWR)
            except OSError: pass
def handle(c):
    head = b""
    while b"\r\n\r\n" not in head:
        d = c.recv(4096)
        if not d: return c.close()
        head += d
    method, target = head.split(b" ")[:2]
    host, _, port = target.decode().partition(":")
    if method != b"CONNECT" or host not in ALLOWED:
        print(f"refused {target.decode()}", file=sys.stderr, flush=True)
        c.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"); return c.close()
    print(f"relayed {target.decode()}", file=sys.stderr, flush=True)
    u = socket.create_connection((host, int(port or 443)))
    c.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
    threading.Thread(target=pipe, args=(c, u), daemon=True).start(); pipe(u, c)
while True:
    conn, _ = srv.accept(); threading.Thread(target=handle, args=(conn,), daemon=True).start()
PY
python3 -u "$base/proxy.py" > "$base/port" 2> "$base/proxy.log" & proxy=$!
python3 -m http.server 0 --bind 127.0.0.1 --directory "$base" > "$base/other.log" 2>&1 & other=$!
sleep 1; port=$(cat "$base/port"); otherport=$(grep -o 'port [0-9]*' "$base/other.log" | head -1 | cut -d' ' -f2)
echo other-local-service > "$base/marker.txt"
run() { # $1 ingress default
  cat > "$base/req.json" <<J
{"version":"1.0.0","containment":"seatbelt","process":{"commandLine":"env | grep -i _proxy; curl -s -o /dev/null -m 10 -w 'allowed=%{http_code}\\\\n' https://registry.npmjs.org/; curl -sS -o /dev/null -m 10 https://example.com/; echo unlisted=\$?; curl -s -o /dev/null -m 10 --noproxy '*' https://registry.npmjs.org/; echo direct=\$?; curl -s -m 5 --noproxy '*' http://127.0.0.1:$otherport/marker.txt; echo loopback=\$?","cwd":"$root","env":["PATH=/usr/bin:/bin"]},
 "filesystem":{"readwritePaths":["$root"],"readonlyPaths":["/usr","/bin","/System","/Library","/private/etc"]},
 "network":{"egress":{"default":"deny"},"ingress":{"default":"$1"}},"runtimeConfig":{"networkProxy":"http://127.0.0.1:$port"}}
J
  "$X" "$base/req.json"; echo "[rc=$?]"
}
echo "== proxy $port, ingress deny"; run deny
echo "== proxy $port, ingress allow"; run allow
echo "== proxy log"; cat "$base/proxy.log"
kill $proxy $other; rm -rf "$base"
