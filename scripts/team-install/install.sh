#!/bin/sh
# Installs pi-outpost with the pi-permission-system extension and a team policy,
# and optionally OpenLore's structural code tools.
#   sh install.sh [--with-openlore] [policy.json]
# The policy file defaults to permission-policy.json next to this script.
set -e
here=$(cd "$(dirname "$0")" && pwd)
with_openlore=no
if [ "$1" = "--with-openlore" ]; then
  with_openlore=yes
  shift
fi
policy=${1:-"$here/permission-policy.json"}
agent_dir=${PI_OUTPOST_AGENT_DIR:-"$HOME/.pi/agent"}

[ -f "$policy" ] || { echo "Policy file not found: $policy" >&2; exit 1; }

# pi's own installer, fetched by npx: it records a package in $agent_dir, where
# pi-outpost loads it on start. No global pi needed.
pi_install() {
  PI_CODING_AGENT_DIR="$agent_dir" npx -y @earendil-works/pi-coding-agent install "$1"
}

echo "1/4  pi-outpost"
npm install -g pi-outpost

echo "2/4  permission system extension"
pi_install npm:@gotgenes/pi-permission-system

echo "3/4  policy"
mkdir -p "$agent_dir/extensions/pi-permission-system"
cp "$policy" "$agent_dir/extensions/pi-permission-system/config.json"

if [ "$with_openlore" = yes ]; then
  echo "4/4  OpenLore"
  pi_install npm:openlore
else
  echo "4/4  OpenLore skipped (--with-openlore to install it)"
fi

echo "Done. Start it with: pi-outpost"
