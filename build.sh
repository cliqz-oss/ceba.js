#!/bin/bash
set -e

# TODO: can we try with emconfigure? It's just the optimization flags...
# TODO: LZ4?
# TODO: SINGLE_FILE = 1

### libressl
(cd external/libressl && \
 git apply ../../patches/libressl/portable/* && \
 ./autogen.sh && \
 CPPFLAGS="-O2" emconfigure ./configure --disable-asm --disable-shared && emmake make)

### zlib
(cd external/zlib && AR=llvm-ar CFLAGS="-O2" CC=emcc ./configure --static && make)

### libevent

# with ssl and zlib
# CPPFLAGS="-I$HOME/torjs/external/zlib/include -I$HOME/torjs/external/zlib -I$HOME/torjs/external/libressl -I$HOME/torjs/external/libressl/include" LDFLAGS="-L$HOME/torjs/external/zlib -L$HOME/torjs/external/libressl" emconfigure ./configure --disable-thread-support --disable-shared

(cd external/libevent && ./autogen.sh && \
CPPFLAGS="-O2" emconfigure ./configure --disable-thread-support --disable-shared --disable-openssl --disable-samples --disable-libevent-regress &&\
sed -i.bak -e 's/#define HAVE_ARC4RANDOM 1/\/\/ #define HAVE_ARC4RANDOM 0/' ./config.h \
&& emmake make)

### tor
cp ./external/libressl/ssl/.libs/libssl.a ./external/libressl/tls/.libs/libtls.a ./external/libressl/crypto/.libs/*.a ./external/libressl/
cp ./external/libevent/.libs/*.a ./external/libevent


(cd external/tor && ./autogen.sh &&\
CPPFLAGS="-Oz" emconfigure ./configure --with-libevent-dir=../libevent/ --with-ssl-dir=../libressl/ --with-zlib-dir=../zlib/ --disable-asciidoc && emmake make)


cp ./external/tor/src/or/tor ./build/tor.bc

emcc -I external/libevent/include/ --js-library library_sockfs.js --js-library library_syscall.js --pre-js pre.wasm.js -Oz --llvm-lto 1 \
 -s WASM=1 -s MEMFS_APPEND_TO_TYPED_ARRAYS=1 -s ALLOW_MEMORY_GROWTH=1 -s NO_EXIT_RUNTIME=1 -s RESERVED_FUNCTION_POINTERS=1 ./build/tor.bc http.c \
 external/libevent/.libs/libevent.a -o ./build/tor.js
