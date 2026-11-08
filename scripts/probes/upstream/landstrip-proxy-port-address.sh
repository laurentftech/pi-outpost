#!/bin/bash
# Probe landstrip's network policy: the proxy port, on every loopback address (landstrip-proxy-port-address.md).
LT=${LT:-$HOME/lt/0.20.26/squashfs-root/usr/bin/landstrip}
W=$(mktemp -d)
cd "$W"
# servers: proxy-ish port on 127.0.0.1:P, another on 127.0.0.1:O, same P on 127.0.0.2, P on ::1, unix socket
python3 - <<'PY' &
import socket, threading, os
def serve(fam, addr):
    s=socket.socket(fam); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR,1); s.bind(addr); s.listen()
    def loop():
        while True:
            c,_=s.accept(); c.sendall(b"HELLO\n"); c.close()
    threading.Thread(target=loop,daemon=True).start()
serve(socket.AF_INET,("127.0.0.1",47001))
serve(socket.AF_INET,("127.0.0.1",47002))
serve(socket.AF_INET,("127.0.0.2",47001))
serve(socket.AF_INET6,("::1",47001))
u=socket.socket(socket.AF_UNIX); p=os.path.join(os.getcwd(),"s.sock"); u.bind(p); u.listen()
def ul():
    while True:
        c,_=u.accept(); c.sendall(b"HELLO\n"); c.close()
threading.Thread(target=ul,daemon=True).start()
open("ready","w").close()
import time; time.sleep(60)
PY
while [ ! -f ready ]; do sleep 0.1; done
cat > policy.json <<J
{"filesystem":{"denyRead":["/"],"allowRead":["/usr","/etc","/lib","/lib64","/bin","/sbin","$W"],"allowWrite":["$W","/dev/null"]},
 "network":{"allowNetwork":false,"allowLocalBinding":false,"httpProxyPort":47001}}
J
cat > probe.py <<'PY'
import socket,sys
def t(name, fam, addr, udp=False):
    try:
        s=socket.socket(fam, socket.SOCK_DGRAM if udp else socket.SOCK_STREAM); s.settimeout(3)
        s.connect(addr)
        if udp: s.send(b"x"); print(name,"SENT"); return
        print(name, s.recv(16).decode().strip() or "EMPTY")
    except Exception as e: print(name,"REFUSED",type(e).__name__, e)
t("proxy 127.0.0.1:47001", socket.AF_INET, ("127.0.0.1",47001))
t("other 127.0.0.1:47002", socket.AF_INET, ("127.0.0.1",47002))
t("same-port 127.0.0.2:47001", socket.AF_INET, ("127.0.0.2",47001))
t("same-port ::1:47001", socket.AF_INET6, ("::1",47001))
t("public 1.1.1.1:443", socket.AF_INET, ("1.1.1.1",443))
t("udp 1.1.1.1:53", socket.AF_INET, ("1.1.1.1",53), udp=True)
t("unix s.sock", socket.AF_UNIX, sys.argv[1])
try:
    s=socket.socket(); s.bind(("127.0.0.1",47009)); s.listen(); print("listen OPEN")
except Exception as e: print("listen REFUSED",type(e).__name__)
PY
"$LT" run -p policy.json -- /usr/bin/python3 probe.py "$W/s.sock" 2>&1
echo "exit=$?"
kill %1 2>/dev/null; rm -rf "$W"
