#!/bin/bash
set -e

./build_libressl.sh
./build_zlib.sh
./build_libevent.sh

cp ./external/libressl/ssl/.libs/libssl.a ./external/libressl/tls/.libs/libtls.a ./external/libressl/crypto/.libs/*.a ./external/libressl/
cp ./external/libevent/.libs/*.a ./external/libevent

# Building with -O2 or -O3 gives error of unsupported 128 bit operation
(cd external/tor && ./autogen.sh &&\
emconfigure ./configure --with-libevent-dir=../libevent/ --with-ssl-dir=../libressl/ --with-zlib-dir=../zlib/ --disable-asciidoc &&\
 emmake make)

cp ./external/tor/src/or/tor ./build/tor.bc

emcc --js-library library_sockfs.js -O3 -s WASM=1 ./build/tor.bc -o ./build/tor.html
