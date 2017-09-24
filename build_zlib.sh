#!/bin/bash
set -e

(cd external/zlib && AR=llvm-ar CFLAGS="-O3" CC=emcc ./configure --static && make)
