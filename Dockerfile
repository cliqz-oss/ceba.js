FROM trzeci/emscripten:sdk-tag-1.37.35-64bit@sha256:9776e2720ef23f5fc85b1984239bade8f67a7e447c6625936e8dec480ec525f5

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
