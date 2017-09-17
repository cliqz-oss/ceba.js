#!/bin/bash
set -e

(cd lib/zlib && AR=llvm-ar CFLAGS="-O3" CC=emcc ./configure --static && make)
