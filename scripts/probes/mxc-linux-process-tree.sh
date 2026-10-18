#!/usr/bin/env bash
# Inside the scripts/mxc-linux image (documented flags): run an interactive bash through lxc-exec,
# cd into a subfolder, and print the process tree under lxc-exec with each process's cwd.
# Shows which process getCwd must read (terminalManager.ts shellUnder).
set -u
arch=$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')
X=/app/node_modules/@microsoft/mxc-sdk/bin/$arch/lxc-exec
root=$(mktemp -d)/app; mkdir -p "$root/sub"
cat > /tmp/req.json <<J
{"version":"1.0.0","containment":"bubblewrap","process":{"commandLine":"/bin/bash --norc -i","cwd":"$root","env":["PATH=/usr/bin:/bin"]},"filesystem":{"readwritePaths":["$root"],"readonlyPaths":["/usr","/etc","/lib","/lib64","/bin"]},"network":{"egress":{"default":"allow"}}}
J
( sleep 1; echo "cd sub"; sleep 2; echo exit ) | script -qfc "$X /tmp/req.json" /dev/null >/dev/null &
sleep 2
for p in /proc/[0-9]*; do
  n=$(cat $p/comm 2>/dev/null); pp=$(awk '{print $4}' $p/stat 2>/dev/null)
  echo "${p#/proc/} ppid=$pp $n cwd=$(readlink $p/cwd 2>/dev/null) cmd=$(tr "\0" " " < $p/cmdline 2>/dev/null | cut -c1-160)"
done | sort -n
wait
