#!/bin/bash
set -e

# TODO: can we try with emconfigure? It's just the optimization flags...
# TODO: LZ4?
# TODO: SINGLE_FILE = 1

### libressl
(cd external/libressl && \
 for file in ../../patches/libressl/portable/*; do patch -p1 -i "$file"; done && \
 ./autogen.sh && \
 CPPFLAGS="-O2" emconfigure ./configure --disable-asm --disable-shared && emmake make)

cp ./external/libressl/ssl/.libs/libssl.a ./external/libressl/tls/.libs/libtls.a ./external/libressl/crypto/.libs/*.a ./external/libressl/

### zlib
(cd external/zlib && AR=emar CFLAGS="-O2" CC=emcc ./configure --static && make)

### libevent

# without ssl and zlib
# CPPFLAGS="-O2" emconfigure ./configure --disable-thread-support --disable-shared --disable-openssl --disable-samples --disable-libevent-regress

(cd external/libevent && ./autogen.sh && \
 CPPFLAGS="-O2 -I../zlib/include -I../zlib -I../libressl -I../libressl/include" LDFLAGS="-L../zlib -L../libressl" emconfigure ./configure --disable-thread-support --disable-shared &&\
 sed -i.bak -e 's/#define HAVE_ARC4RANDOM 1/\/\/ #define HAVE_ARC4RANDOM 0/' ./config.h &&\
 for file in ../../patches/libevent/*; do patch -p1 -i "$file"; done && \
 emmake make)

cp ./external/libevent/.libs/*.a ./external/libevent


### tor

(cd external/tor && for file in ../../patches/tor/*; do patch -p1 -i "$file"; done && ./autogen.sh &&\
CPPFLAGS="-Oz" emconfigure ./configure --with-libevent-dir=../libevent/ --with-ssl-dir=../libressl/ --with-zlib-dir=../zlib/ --disable-asciidoc && emmake make)

mkdir -p build

cp ./external/tor/src/or/tor ./build/tor.bc

emcc -I external/libressl/include/ -Iexternal/libevent/ -I external/libevent/include/ --js-library library_sockfs.js --js-library library_syscall.js \
 --pre-js pre.wasm.js -Oz --llvm-lto 1  -s WASM=1 -s MEMFS_APPEND_TO_TYPED_ARRAYS=1 -s ALLOW_MEMORY_GROWTH=1 -s NO_EXIT_RUNTIME=1 -s RESERVED_FUNCTION_POINTERS=1 \
 ./build/tor.bc http/*.c external/libevent/.libs/libevent_openssl.a external/libevent/.libs/libevent.a  -o ./build/tor.js \
 --embed-file /etc/ssl/certs/ca-certificates.crt@/etc/ssl/certs/ca-certificates.crt
