#!/bin/bash
set -e

(cd lib/libressl && ./autogen.sh &&\
 mkdir -p build && cd build && emcmake cmake .. && emmake make\
)
