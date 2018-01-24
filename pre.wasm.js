// This goes inside worker (from https://github.com/niklasf/stockfish.js)
//var Module;
//if (!Module) Module = (typeof Module !== 'undefined' ? Module : null) || {};

function isPrivate(ip) {
  return /^10\.|^192\.168\.|^172\.16\.|^172\.17\.|^172\.18\.|^172\.19\.|^172\.20\.|^172\.21\.|^172\.22\.|^172\.23\.|^172\.24\.|^172\.25\.|^172\.26\.|^172\.27\.|^172\.28\.|^172\.29\.|^172\.30\.|^172\.31\./.test(ip);
}

function randomByte() {
  return Math.round(Math.random()*256);
}

function randomIp() {
  var ip = randomByte() +'.' +
           randomByte() +'.' +
           randomByte() +'.' +
           randomByte();
  if (isPrivate(ip)) return randomIp();
  return ip;
}

function randomPort() {
  return 49152 + Math.floor(Math.random() * (65536 - 49152));
}

var queue = [];
var sockets = {};
var canRun = false;

var server;

function processMessage(m) {
  var id = m.id;
  if (m.action === 'socket') {
    // onopen, onclose, onmessage, onerror
    var ip = randomIp();
    var port = randomPort();

    // TODO: check onerror, onopen...?
    var ws = {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
      _socket: {
        remoteAddress: ip,
        remotePort: port,
      },
      send: function(data) {
        postMessage({ action: 'send', id: id, data: data });
      },
      close: function() {
        ws.readyState = ws.CLOSED;
        delete sockets[id];
        ws.onclose();
        postMessage({ action: 'close', id: id });
      },
      readyState: 1,
    };

    sockets[id] = ws;
    server.listeners.connection(ws);
    postMessage({ action: 'connect', id: id });
  } else if (m.action === 'send') {
    if (sockets[id]) {
      sockets[id].onmessage({
        data: m.data,
      });
    }
  } else if (m.action === 'close') {
    if (sockets[id]) {
      sockets[id].close();
    }
  }
}

var bridge;

onmessage = function (e) {
  if (e.data.action === 'run') {
    bridge = e.data.bridge;

    function doRun() {
      if (e.data.silent) {
        Module.print = function () {};
      }
      if (e.data.noErrors) {
        Module.printErr = function () {};
      }
      Module.callMain(['usebridges', '1', 'bridge', bridge, 'DataDirectory', '/torjs']);
    }

    if (canRun) {
      doRun();
    } else {
      Module.postRun.push(doRun);
    }
  } else if (queue !== null) {
    queue.push(e.data);
  }
  else {
    processMessage(e.data);
  }
};

var xhr = new XMLHttpRequest();
xhr.open('GET', 'tor.wasm', false);
xhr.responseType = 'arraybuffer';
xhr.send(null);

// Module
Module.wasmBinary = xhr.response;
Module.noInitialRun = true;
Module.WebSocket = WebSocket;
Module.websocketserver = function(config) {
  // TODO: is it ok for this to be hardcoded?
  if (server || !config || config.host !== '127.0.0.1' || config.port !== 9050) {
    abort('Tried listening to unknown server');
  }
  this.listeners = {};
  this.on = function(name, cb) {
    this.listeners[name] = cb;
  };
  server = this;

  // TODO: better way?
  setTimeout(function() {
    for (var i = 0; i < queue.length; i++) {
      processMessage(queue[i]);
    }
    queue = null;
  }, 100);
};

function persist() {
  FS.syncfs(false, function (err) {
    setTimeout(persist, 60 * 1000);
  });
}

Module.preRun = (Module.preRun || []).concat(function() {
  addRunDependency('syncfs');
  FS.mkdir('/torjs');
  FS.mount(IDBFS, {}, '/torjs');
  FS.syncfs(true, function (err) {
    if (err) throw err;
    removeRunDependency('syncfs');
    setTimeout(persist, 20 * 1000); // TODO: do after bootstrap...
  });
});

Module.postRun = (Module.postRun || []).concat(function() {
  delete Module.wasmBinary; // free some memory
  xhr = undefined;
  canRun = true;
});
