#!/bin/bash
set -e

(cd lib/libressl && ./autogen.sh &&\
 AR=llvm-ar CC=emcc ./configure --disable-asm --disable-shared && make\
)
