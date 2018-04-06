#!/bin/bash
set -e

### libressl
(cd external/libressl && \
 for file in ../../patches/libressl/portable/*; do patch -p1 -i "$file"; done && \
 ./autogen.sh && \
 CPPFLAGS="-Oz" emconfigure ./configure --disable-asm --disable-shared && emmake make)

cp ./external/libressl/ssl/.libs/libssl.a ./external/libressl/tls/.libs/libtls.a ./external/libressl/crypto/.libs/*.a ./external/libressl/

### zlib
(cd external/zlib && AR=emar CFLAGS="-Oz" CC=emcc ./configure --static && make)

### libevent
(cd external/libevent && ./autogen.sh && \
 CPPFLAGS="-Oz" emconfigure ./configure --disable-thread-support --disable-shared --disable-openssl --disable-samples --disable-libevent-regress && \
 sed -i.bak -e 's/#define HAVE_ARC4RANDOM 1/\/\/ #define HAVE_ARC4RANDOM 0/' ./config.h && \
 emmake make)

cp ./external/libevent/.libs/*.a ./external/libevent

### tor
(cd external/tor && for file in ../../patches/tor/*; do patch -p1 -i "$file"; done && ./autogen.sh &&\
CPPFLAGS="-Oz" emconfigure ./configure --with-libevent-dir=../libevent/ --with-ssl-dir=../libressl/ --with-zlib-dir=../zlib/ --disable-asciidoc && emmake make)

mkdir -p build

cp ./external/tor/src/or/tor ./build/tor.bc

emcc --js-library library_sockfs.js --js-library library_syscall.js -Oz --llvm-lto 1 \
 --pre-js pre.js -s MODULARIZE=1 -s WASM=1 -s MEMFS_APPEND_TO_TYPED_ARRAYS=1 -s ALLOW_MEMORY_GROWTH=1 -s NO_EXIT_RUNTIME=1 ./build/tor.bc -o ./build/tor.js
