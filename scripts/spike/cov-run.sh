#!/usr/bin/env bash
# SPIKE (not for main): every server suite, unit and integration, with V8 coverage on.
# The servers the integration suites start write their own coverage when they exit;
# each batch's raw files are cut down to server/src before the next batch runs.
set -u
OUT="$RUNNER_TEMP/cov"
cd server || exit 1
rm -rf "$OUT" && mkdir -p "$OUT/unit" "$OUT/int" "$OUT/logs"
run_batch() { # $1 = unit|int, rest = suite files
  kind=$1; shift
  raw="$OUT/raw"; rm -rf "$raw"; mkdir -p "$raw"
  log="$OUT/logs/$kind-$(date +%s%N).log"
  t0=$(date +%s)
  NODE_V8_COVERAGE="$raw" SPIKE_SERVER_COVERAGE="$raw" CI=true \
    node --import tsx/esm --test --test-timeout=300000 --test-reporter=tap "$@" > "$log" 2>&1
  t1=$(date +%s)
  raw_mb=$(du -sm "$raw" | cut -f1)
  filtered=$(node ../scripts/spike/cov-filter.cjs "$raw" "$OUT/$kind")
  echo "$kind batch of $#: $((t1 - t0)) s tests, raw ${raw_mb} MB; ok $(grep -c '^ok ' "$log") not-ok $(grep -c '^not ok ' "$log"); $filtered"
}
start=$(date +%s)
mapfile -t unit < <(ls test/*.test.ts)
mapfile -t int < <(ls test/*.test.mjs)
for ((i = 0; i < ${#unit[@]}; i += 60)); do run_batch unit "${unit[@]:i:60}"; done
echo "unit done after $(( $(date +%s) - start )) s"
t_int=$(date +%s)
for ((i = 0; i < ${#int[@]}; i += 20)); do run_batch int "${int[@]:i:20}"; done
echo "integration done after $(( $(date +%s) - t_int )) s"
rm -rf "$OUT/raw"
du -sh "$OUT/unit" "$OUT/int"
grep -h '^not ok ' "$OUT"/logs/*.log | head -20 || true
