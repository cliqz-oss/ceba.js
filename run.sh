#!/bin/bash
set -e

cp fetch-tor-factory.js build
emrun ./build/tor.html
