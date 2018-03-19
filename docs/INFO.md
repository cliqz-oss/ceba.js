# ceba.js

An *experimental* WebAssembly build of the Tor client.

## Disclaimer

This is produced independently and carries no guarantee from the Tor Project organization. Any references to Tor do not imply endorsement from the Tor Project.

## Build
First it is needed to pull the submodules:
```
git submodule update --init
```
If Docker is installed and can be run then
```
make
```
should work and the output files will be in the *build* folder.

Instead, if the WebAssembly (Emscripten) toolchain is installed and activated (see http://webassembly.org/getting-started/developers-guide/), you can also run:

```
./build.sh
```
with the same effects.

## Usage

The build process outputs one file: ```tor.js```, which contains the WebAssembly module and all required glue code. We need to import the ```createModule``` function, which will differ depending on the environment:

### WebWorker
```js
importScripts('tor.js');
const createModule = self.Module;
```

### NodeJS
```js
const createModule = require('./tor');
```

Once ```createModule``` is imported, we can create a Tor instance:

```js
const tor = createModule({
  arguments,
  CustomSocketServer,
  CustomSocket,
});
```

Where ```arguments``` is an string array containing the arguments that would be passed to the Tor executable, ```CustomSocketServer``` a class implementing the same interface as the WebSocket server in https://github.com/websockets/ws, and ```CustomSocket``` a class implementing the same interface as a WebSocket.

Emscripten networking implementation converts TCP sockets into WebSockets. Every TCP socket gets converted into a binary WebSocket with address: ```ws://address:port```. We make this configurable via the ```CustomSocket``` constructor parameter, which we can convert back to a TCP socket if we have an API available for that in the JavaScript context (e.g. Nodejs, Firefox legacy extension, etc.).

Tor client usually listens for TCP connections at one or more ports (9050, ...). That is why we need ```CustomSocketServer```. Whenever the *native* code wants to listen to some port, an instance of this class will be created. By providing a custom implementation of this class we can communicate with each port in JavaScript, simulating the local listening servers.
## Example

You can try an example (should work with a NodeJS version supporting WebAssembly):
```
node examples/client.js SocksPort 6666
```
This should create a Tor client listening on socks port 6666. Note that the example does not handle reading or writing from the file system.

## Patches

In the current project structure we have four submodules in external: *libevent*, *libressl*, *tor* and *zlib*, pointing to the original repositories. In order to be able to compile with Emscripten we need to patch some of them. Patches are in the *patches* folder.

### libevent

The patch is basically to define an appropriate ```OPENSSL_VERSION_NUMBER``` taking into consideration that we are using Libressl.

### libressl
* Fix some includes so that Emscripten is treated as Linux environment.
* Remove some .gnu.warning. assembly code that breaks build.
* Only use ```getentropy_urandom``` in ```getentropy_linux.c``` (other fallbacks are not available and break the build). Emscripten maps /dev/random and /dev/urandom to crypto.getRandomValues API, so it should be fine.
* Make _ARC4_ATFORK be noop. We cannot fork in Emscripten, so this will never be called, and removes an undefined reference in compilation.
### tor
* Tor main loop is restructured to be able to run in JavaScript (see https://kripken.github.io/emscripten-site/docs/porting/emscripten-runtime-environment.html#browser-main-loop). Basically we need to avoid any infinite loop, so we refactor it so that we have a ```step``` function that is called periodically, simulating the infinite loop.

## Emscripten libraries

We copy and patch a couple of libraries from ```https://github.com/kripken/emscripten/tree/incoming/src```: ```library_sockfs.js``` and ```library_syscall.js```. We need this because even though Emscripten implements many syscalls and socket operations in a safe way, we still needed to make some modifications in order for the Tor wasm client to work. This modifications we make should be reviewed in detail at some point.

## Persistence
Usually the persistence APIs that are available in JavaScript environments are asynchronous, which could be a problem, because in native (C, C++) usually file system operations are synchronous (blocking). That is why Emscripten implements file system operations in-memory, to ensure that they can be executed fast and synchronously. To achieve persistence we must explicitly sync this in-memory FS state to disk (via some of the available or custom backends).

## Caveats/concerns

* The Tor main loop needs to be converted into a step function that is called *N* times per second. Right now it is hardcoded at 100 *frames per second*, but this is clearly suboptimal (and arbitrary). There are times were the loop step should be called more often, and times where it should be called less often. Would need to see if this can be improved.
* Emscripten handles FS operations synchronously in-memory, which must be explicitly persisted to disk *from time to time*. This should probably rule out problems with inconsistent file system, but we might have problems were the persited state is slightly outdated with respect to the in-memory state.
* Need to verify modifications and implementation in ```library_socksfs.js``` and ```library_syscalls.js```, especially the ones related with TCP sockets. We should be able to keep the same behaviour as the native client, and make sure that a ```torjs``` client cannot be distinguished from a native client other Tor nodes.
* Right now in the final build it warns about an undefined reference to the function ```getgrgid```. Seems not to be used in the paths we have tried, but should probably do something about it. If at some point it is called then WebAssembly execution should abort with an error.
