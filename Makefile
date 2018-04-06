SHELL := /bin/bash

all:
	docker build . -t torjs
	./docker-helpers/extract-files-from-image.sh build torjs /torjs/build/tor.js /torjs/build/tor.wasm
