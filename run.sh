#!/bin/bash
set -e

cp tor.html fetch-tor-factory.js build
emrun ./build/tor.html
