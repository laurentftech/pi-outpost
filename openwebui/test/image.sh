#!/usr/bin/env bash
# The container image, run as a deployment runs it.
#
#   openwebui/test/image.sh [image]     (default: pi-outpost-plannings:dev)
#
# Needs docker, curl and node. Covers the spec scenarios
# TheImageServesFromItsEnvironment, TheImageRefusesToStartWithoutASecret and
# APlanningOutlivesTheContainer. Exits non-zero on the first failure.
set -euo pipefail

IMAGE=${1:-pi-outpost-plannings:dev}
SECRET=image-test-secret
KEY=image-test-identity-key-0123456789abcdef
PORT=18790
NAME=plannings-image-test
VOLUME=plannings-image-test-data

fail() { echo "FAIL: $*" >&2; exit 1; }
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

token() {
  node -e '
    const { createHmac } = require("node:crypto");
    const part = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const body = part({ alg: "HS256", typ: "JWT" }) + "." + part({ sub: process.argv[2], iss: "open-webui", iat: now, exp: now + 300 });
    process.stdout.write(body + "." + createHmac("sha256", process.argv[1]).update(body).digest("base64url"));
  ' "$KEY" "$1"
}

start() {
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8790" -v "$VOLUME:/data" \
    -e OWUI_PLANNING_SECRET="$SECRET" -e OWUI_PLANNING_IDENTITY_KEY="$KEY" "$IMAGE" >/dev/null
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null -H "Authorization: Bearer $SECRET" "http://127.0.0.1:$PORT/openapi.json" && return 0
    sleep 0.5
  done
  docker logs "$NAME" >&2
  fail "the container never answered"
}

call() { # tool, json body
  curl -s -X POST "http://127.0.0.1:$PORT/$1" -H "Authorization: Bearer $SECRET" \
    -H "X-OpenWebUI-User-Jwt: $(token alice)" -H 'Content-Type: application/json' -d "$2"
}

echo "-- TheImageRefusesToStartWithoutASecret"
set +e
out=$(docker run --rm -e OWUI_PLANNING_IDENTITY_KEY="$KEY" "$IMAGE" 2>&1)
status=$?
set -e
[ "$status" -ne 0 ] || fail "started without a secret"
grep -q "OWUI_PLANNING_SECRET is not set" <<<"$out" || fail "did not name the missing setting: $out"

echo "-- TheImageServesFromItsEnvironment"
start
docs=$(curl -s -H "Authorization: Bearer $SECRET" "http://127.0.0.1:$PORT/openapi.json")
grep -q '"operationId":"create_planning"' <<<"$docs" || fail "no OpenAPI description"
planning='{"schema":"urn:structured-exchange:3","kind":"timeline","data":{"title":"Image test","time":{"start":"2027-01-01","end":"2027-03-31","scale":"month"},"rows":[{"type":"task","id":"T1","label":"Work","items":[{"type":"milestone","id":"m1","date":"2027-02-01"}]}]}}'
created=$(call create_planning "{\"planning\":$planning}")
id=$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id ?? "")' "$created")
[ -n "$id" ] || fail "create_planning answered: $created"
docker exec "$NAME" sh -c "ls /data/*/$id/1.json" >/dev/null || fail "no revision file in the volume"
shown=$(call show_planning "{\"id\":\"$id\"}")
grep -q 'data-script="H4sI' <<<"$shown" || fail "show_planning did not embed the viewer"
graph='{"schema":"urn:structured-exchange:1","kind":"graph","data":{"nodes":[{"id":"a","label":"A"},{"id":"b","label":"B"}],"edges":[{"from":"a","to":"b","kind":"flow"}]}}'
structure=$(call show_structure "{\"document\":$graph}")
grep -q 'data-script="H4sI' <<<"$structure" || fail "show_structure did not embed the viewer: ${structure:0:200}"

echo "-- APlanningOutlivesTheContainer"
docker rm -f "$NAME" >/dev/null
start
read=$(call get_planning "{\"id\":\"$id\"}")
node -e '
  const read = JSON.parse(process.argv[1]);
  if (read.planning?.data?.title !== "Image test" || read.revision !== 1) { console.error(process.argv[1]); process.exit(1); }
' "$read" || fail "the planning did not survive the container"

echo "image checks passed"
