.PHONY: build
build:
	../node/node ../node/deps/npm/node_modules/node-gyp/bin/node-gyp.js rebuild --directory=. --nodedir=../node

run: build
	../node/node index.js
