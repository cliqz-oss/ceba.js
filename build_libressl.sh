#!/bin/bash
set -e

(cd lib/libressl && ./autogen.sh && \
CFLAGS="-O3" AR=llvm-ar CC=emcc ./configure --disable-asm --disable-shared && make\
)
