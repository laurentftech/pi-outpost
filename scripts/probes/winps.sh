#!/bin/sh
# Run a PowerShell script on the Windows test VM (`ssh utm-win`), passed encoded so no
# quoting survives two shells. Usage: scripts/probes/winps.sh '<powershell>'
# Output only comes back when the remote command ends: write long runs to a file.
enc=$(printf '%s' "$1" | iconv -t UTF-16LE | base64 | tr -d '\n')
exec ssh -o BatchMode=yes "${WIN_HOST:-utm-win}" "powershell -NoProfile -NonInteractive -EncodedCommand $enc"
