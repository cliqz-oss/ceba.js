FROM trzeci/emscripten:sdk-tag-1.37.28-64bit@sha256:2ae1da959eb0b4765a2624b05ff4a0ad55d044b4f324644b08bde5791bc3afb4

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
WORKDIR /torjs

RUN ./build.sh
