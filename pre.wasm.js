// FIXME: this depends on tor port being 9050...
var doneCheck = setInterval(function() {
  if (servers[9050]) {
    clearInterval(doneCheck);
    for (var i = 0; i < queue.length; i++) {
      processMessage(queue[i]);
    }
    queue = null;
  }
}, 100);

function randID() {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}

/// FakeLocalSocket
var sockets = {};

FakeLocalSocket.CONNECTING = 0;
FakeLocalSocket.OPEN = 1;
FakeLocalSocket.CLOSING = 2;
FakeLocalSocket.CLOSED = 3;

function FakeLocalSocket(id, remoteAddress, remotePort) {
  // Seems that WebSockets have these both in prototype and as 'static' properties.
  this.CONNECTING = 0;
  this.OPEN = 1;
  this.CLOSING = 2;
  this.CLOSED = 3;

  this.id = id;
  sockets[this.id] = this;
  this.readyState = FakeLocalSocket.OPEN;
  this._socket = {
    remoteAddress: remoteAddress,
    remotePort: remotePort,
  };
}

FakeLocalSocket.prototype.send = function(data) {
  postMessage({ action: 'send', id: this.id, data: data });
}

FakeLocalSocket.prototype.close = function(data) {
  if (this.closed) {
    return;
  }
  this.closed = true;
  delete sockets[this.id];
  this.readyState = FakeLocalSocket.CLOSED;
  postMessage({ action: 'close', id: this.id });
}
/// end FakeLocalSocket

/// FakeRemoteSocket
var remotesockets = {};

FakeRemoteSocket.CONNECTING = 0;
FakeRemoteSocket.OPEN = 1;
FakeRemoteSocket.CLOSING = 2;
FakeRemoteSocket.CLOSED = 3;

function FakeRemoteSocket(url, protocols) {
  // Seems that WebSockets have these both in prototype and as 'static' properties.
  this.CONNECTING = 0;
  this.OPEN = 1;
  this.CLOSING = 2;
  this.CLOSED = 3;

  if (url.indexOf('ws://') === 0 && protocols[0] === 'binary') {
    var sp = (url.slice(5).split('/')[0] || '').split(':');
    this.host = sp[0];
    this.port = parseInt(sp[1], 10);
  }

  if (!this.host || !Number.isInteger(this.port)) {
    printErr('Tried to create socket with wrong host or port ' + url + ' ' + protocols);
    throw new Error('Invalid host or port for socket');
  }

  this.id = randID();
  remotesockets[this.id] = this;
  this.readyState = FakeRemoteSocket.CONNECTING;
  postMessage({ action: 'socketremote', id: this.id, host: this.host, port: this.port });
}

FakeRemoteSocket.prototype.send = function(data) {
  postMessage({ action: 'sendremote', id: this.id, data: data });
}

FakeRemoteSocket.prototype.close = function() {
  if (this.closed) {
    return;
  }
  this.closed = true;
  delete remotesockets[this.id];
  this.readyState = FakeRemoteSocket.CLOSED;
  postMessage({ action: 'closeremote', id: this.id });
  if (this.onclose) {
    this.onclose();
  }
}
/// end FakeRemoteSocket


// FakeSocketServer

// local listening servers, indexed by port
// by default it will just be one server listening to 9050
var servers = {};

function FakeSocketServer (config) {
  if (!config || config.host !== '127.0.0.1' || typeof config.port !== 'number' || servers[config.port]) {
    throw new Error('Wrong listening server ' + (config && config.port));
  }
  this.config = config;
  this.listeners = {};
  servers[config.port] = this;
}

FakeSocketServer.prototype.on = function(name, cb) {
  this.listeners[name] = cb;
};

FakeSocketServer.prototype.connection = function(ws) {
  if (this.listeners.connection) {
    postMessage({ action: 'connect', id: ws.id });
    this.listeners.connection(ws);
  } else {
    ws.close();
  }
};

FakeSocketServer.prototype.close = function() {
  if (this.closed) {
    return;
  }
  this.closed = true;
  Object.keys(this.sockets).forEach(function(x) {
    try {
      this.sockets[x].close();
    } catch (e) {
      // pass
    }
  });
  delete this.sockets;
  delete this.listeners;
  if (servers[this.config.port] === this) {
    delete servers[this.config.port];
  }
  delete this.config;
}

/// end FakeSocketServer

Module.websocketserver = FakeSocketServer;

var queue = [];
var canRun = false;
var socketCount = 0;

function processMessage(m) {
  var id = m.id;
  if (m.action === 'socket') {
    var serverPort = m.port;
    var ip = '127.0.0.1';
    // let's try to preserve linux behaviour
    // FIXME: assuming collisions are very unlikely, should we check?
    var port = 32768 + socketCount;
    if (port > 61000) {
      socketCount = 0;
    }
    var server = servers[serverPort];
    var ws = new FakeLocalSocket(id, ip, port);
    if (server) {
      server.connection(ws);
    } else {
      ws.close();
    }
  } else if (m.action === 'send') {
    var socket = sockets[id];
    if (socket) {
      socket.onmessage({
        data: m.data,
      });
    }
  } else if (m.action === 'close') {
    var socket = sockets[id];
    if (socket) {
      socket.close();
    }
  } else if (m.action === 'connectremote') {
    var socket = remotesockets[id];
    if (socket) {
      socket.readyState = FakeRemoteSocket.OPEN;
      if (socket.onopen) {
        socket.onopen();
      }
    }
  } else if (m.action === 'sendremote') {
    var socket = remotesockets[id];
    if (socket) {
      socket.onmessage({
        data: m.data,
      });
    }
  } else if (m.action === 'closeremote') {
    var socket = remotesockets[id];
    if (socket) {
      socket.close();
    }
  }
}

onmessage = function (e) {
  if (e.data.action === 'run') {
    function doRun() {
      if (e.data.silent) {
        Module.print = function () {};
      }
      if (e.data.noErrors) {
        Module.printErr = function () {};
      }
      var args = ['DataDirectory', '/torjs'];
      if (e.data.bridge) {
        args = args.concat(['usebridges', '1', 'bridge', e.data.bridge]);
      }
      Module.callMain(args);
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

// TODO: compress?
var xhr = new XMLHttpRequest();
xhr.open('GET', 'tor.wasm', false);
xhr.responseType = 'arraybuffer';
xhr.send(null);

// Module
Module.wasmBinary = xhr.response;
Module.noInitialRun = true;

Module.WebSocket = FakeRemoteSocket;

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
