#!/bin/bash
set -e

(cd lib/zlib && CC=emcc ./configure --static && make)
