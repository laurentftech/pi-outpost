#!/bin/sh
set -eu
umask 077
node /opt/pi-outpost-docker/bootstrap.mjs
exec pi-outpost --config /data/config.json "$@"
