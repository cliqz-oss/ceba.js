#
# Assumes that the "torjs_emscripten" image is locally available.
# Trying to resolve it from an official mirror will fail,
# instead you should once build it locally:
#
# For details, see Dockerfile.emscripten
#
FROM torjs_emscripten

RUN apt-get update && \
    apt-get install -y \
      autoconf \
      libtool \
    && \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /var/cache/apt/*.bin

RUN mkdir /torjs
COPY build.sh /torjs
COPY clean.sh /torjs
COPY external /torjs/external
COPY patches /torjs/patches
COPY library_sockfs.js /torjs
COPY library_syscall.js /torjs
COPY pre.wasm.js /torjs
WORKDIR /torjs

RUN ./build.sh
