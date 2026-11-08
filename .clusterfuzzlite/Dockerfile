# ClusterFuzzLite build image for fuzz/ (docs/development.md § Fuzzing). OSS-Fuzz's JavaScript
# builder, pinned by digest; Dependabot refreshes it.
FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:fff2fe5f532ffcd3fcea7c54cc1db18951b364b64aa37c415348ce8ba17cde34

# The repository installs with its pinned npm 12.2.2, which needs Node 22 or later; the image's
# Node 20 is the one that runs the fuzzers, and the targets are bundled for it. This Node builds only.
ARG NODE_VERSION=24.22.2
ARG NODE_SHA256=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75
RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && mkdir /opt/node-build \
 && tar -xJf /tmp/node.tar.xz -C /opt/node-build --strip-components=1 \
 && rm /tmp/node.tar.xz

COPY . $SRC/pi-outpost
WORKDIR $SRC/pi-outpost
COPY .clusterfuzzlite/build.sh $SRC/
