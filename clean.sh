#!/bin/bash
set -e

(cd external/libevent && git reset HEAD --hard && git clean -fd)
(cd external/libressl && git reset HEAD --hard && git clean -fd)
if [ -d "external/libressl/openbsd" ]; then
  # Control will enter here if $DIRECTORY exists.
  (cd external/libressl/openbsd && git reset HEAD --hard && git clean -fd)
fi
(cd external/tor && git reset HEAD --hard && git clean -fd)
(cd external/zlib && git reset HEAD --hard && git clean -fd)
