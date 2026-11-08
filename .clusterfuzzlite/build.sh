#!/bin/bash -eu
# Build pi-outpost's fuzz targets (fuzz/) into $OUT, as ClusterFuzzLite and OSS-Fuzz run them.
# See docs/development.md § Fuzzing.

# Install and bundle with the build Node and the pinned npm, as CI does (.github/actions/setup-npm).
export PATH=/opt/node-build/bin:$PATH
cd "$SRC/pi-outpost"
npm ci --prefix tools/npm --no-audit --no-fund
export PATH=$SRC/pi-outpost/tools/npm/node_modules/.bin:$PATH
# Only esbuild and the targets' pure-JavaScript dependencies are needed: no install script runs.
npm ci --ignore-scripts --no-audit --no-fund
node fuzz/build.mjs
(cd fuzz && npm ci --no-audit --no-fund)

# compile_javascript_fuzzer copies the project directory into $OUT whole: fuzz/ alone, its
# node_modules holding Jazzer.js and build/ the bundled targets.
cp -r fuzz "$SRC/pi-outpost-fuzz"
for target in mail zip structured-exchange; do
  compile_javascript_fuzzer pi-outpost-fuzz "build/$target.js" --sync
  (cd "fuzz/build/seeds/$target" && zip -q -j "$OUT/${target}_seed_corpus.zip" ./*)
done
