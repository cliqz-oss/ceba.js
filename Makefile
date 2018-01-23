SHELL := /bin/bash

all:
	docker build . -f Dockerfile.emscripten -t torjs_emscripten
	docker build . -f Dockerfile -t torjs
	./docker-helpers/extract-files-from-image.sh build torjs /torjs/build/tor.js /torjs/build/tor.wasm