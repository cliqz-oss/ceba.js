#!/bin/bash
set -e

(cd lib/libevent && ./autogen.sh &&\
AR=llvm-ar CC=emcc ./configure --disable-thread-support --disable-shared --disable-openssl --disable-samples --disable-libevent-regress &&\
 sed -i "/#define HAVE_ARC4RANDOM 1/"' s/^/\/\//' config.h &&\
 make)
