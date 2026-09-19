#!/bin/sh
# Installs pi-outpost with the pi-permission-system extension and a team policy.
#   sh install.sh [policy.json]
# The policy file defaults to permission-policy.json next to this script.
set -e
here=$(cd "$(dirname "$0")" && pwd)
policy=${1:-"$here/permission-policy.json"}
agent_dir=${PI_OUTPOST_AGENT_DIR:-"$HOME/.pi/agent"}

[ -f "$policy" ] || { echo "Policy file not found: $policy" >&2; exit 1; }

echo "1/3  pi-outpost"
npm install -g pi-outpost

echo "2/3  permission system extension"
# pi's own installer, fetched by npx: it records the package in $agent_dir, where
# pi-outpost loads it on start. No global pi needed.
PI_CODING_AGENT_DIR="$agent_dir" npx -y @earendil-works/pi-coding-agent install npm:@gotgenes/pi-permission-system

echo "3/3  policy"
mkdir -p "$agent_dir/extensions/pi-permission-system"
cp "$policy" "$agent_dir/extensions/pi-permission-system/config.json"

echo "Done. Start it with: pi-outpost"
