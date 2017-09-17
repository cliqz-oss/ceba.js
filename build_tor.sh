#!/bin/bash
set -e

cp ./lib/libressl/ssl/.libs/libssl.a ./lib/libressl/tls/.libs/libtls.a ./lib/libressl/crypto/.libs/*.a ./lib/libressl/
cp ./lib/libevent/.libs/*.a ./lib/libevent

# Building with -O2 or -O3 gives error of unsupported 128 bit operation
(cd lib/tor && ./autogen.sh &&\
emconfigure ./configure --with-libevent-dir=../libevent/ --with-ssl-dir=../libressl/ --with-zlib-dir=../zlib/ --disable-asciidoc &&\
 emmake make)
