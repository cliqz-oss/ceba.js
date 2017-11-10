// This goes inside worker (from https://github.com/niklasf/stockfish.js)
var Module;
if (!Module) Module = (typeof Module !== 'undefined' ? Module : null) || {};

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
var requests = {};
var canRun = false;
var timeout;

var myrequest;
var cb_pointer;

// TODO: double check this, are we freeing everything?
function stringToPointer(str) {
  var len = Module.lengthBytesUTF8(str);
  var buf = Module._malloc(len + 1);
  Module.stringToUTF8(str, buf, len + 1);
  return buf;
}

function arrayOfStringsToPointer(array) {
  var buf = Module._malloc(array.length * 4);
  array.forEach(function(str, i) {
    Module.setValue(buf + (i * 4), stringToPointer(str), 'i32');
  });
  return buf;
}

function freeArrayOfStrings(buf, len) {
  for (var i = 0; i < len; ++i) {
    Module._free(Module.getValue(buf + (i * 4), 'i32'));
  }
  Module._free(buf);
}

function processMessage(m) {
  var id = m.id;
  if (m.action === 'request') {
    if (!myrequest) {
      cb_pointer = Module.Runtime.addFunction(function(id, error, code, body, body_len, headers_keys, headers_values, headers_len) {
        var myheaders = {};
        for (var i = 0; i < headers_len; ++i) {
          var ptrKey = Module.getValue(headers_keys + (i * 4), 'i32');
          var ptrValue = Module.getValue(headers_values + (i * 4), 'i32');
          myheaders[Module.UTF8ToString(ptrKey)] = Module.UTF8ToString(ptrValue);
        }
       var mybody = (new Uint8Array(
         Module.HEAPU8.buffer,
         body,
         body_len
       )).slice();

       if (error) {
         postMessage({
           action: 'response',
           id: id,
           error: Module.UTF8ToString(error),
         });
       } else {
         postMessage({
           action: 'response',
           id: id,
           response: {
             status: code,
             body: mybody,
             headers: myheaders,
           },
         });
       }
     });

      myrequest = Module.cwrap(
        'myrequest',
        null,
        [
          'number', // id
          'string', // url
          'string', // method
          'number', // headers_keys
          'number', // header_values
          'number', // headers_len
          'array', // body_in
          'number', // body_in_len
          'number', // timeout
          'number', // cb
        ]
      );
    }

    var headers_keys = arrayOfStringsToPointer(m.request.headers.map(function(x) { return x[0]; }));
    var headers_values = arrayOfStringsToPointer(m.request.headers.map(function(x) { return x[1]; }));
    var headers_len = m.request.headers.length;

    var body_in = new Uint8Array(m.request.body);
    var body_in_len = body_in.length;

    myrequest(
      id,
      m.request.url,
      m.request.method,
      headers_keys,
      headers_values,
      headers_len,
      body_in,
      body_in_len,
      timeout,
      cb_pointer
    );
    freeArrayOfStrings(headers_keys);
    freeArrayOfStrings(headers_values);
  } else if (m.action === 'socket') {
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
    timeout = e.data.timeout || 10;
    bridge = e.data.bridge;

    function doRun() {
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

var server;

// https://samsclass.info/122/proj/how-socks5-works.html
function SocksSocket(ws, domain, port) {
  var self = this;

  this.CONNECTING = 0;
  this.OPEN = 1;
  this.CLOSING = 2;
  this.CLOSED = 3;

  this.readyState = this.CONNECTING;

  this.step = 0;

  this.ws = ws;
  this.domain = domain;
  this.port = port;
  this.ws.onopen = function() {
    self.start();
  };

  this.ws.onclose = function() {
    self.readyState = self.CLOSED;
    self.onclose();
  };

  this.ws.onerror = function(e) {
    self.readyState = self.CLOSED;
    self.onerror(e);
  };

  this._error = function(e) {
    self.onerror(e);
    try {
      self.ws.close();
    } catch (e) {
      // pass
    }
    self.ws = null;
  }

  this.ws.onmessage = function(m) {
    var data = new Uint8Array(m.data);
    if (self.step === 1) {
      if (data.length !== 2 || data[0] !== 5 || data[1] !== 0) {
        self._error(new Error('bad data 1'));
      } else {
        self.connect();
      }
    } else if (self.step === 2) {
      if (data.length !== 10) {
        self._error(new Error('bad data 2'));
      } else {
        self.step = 3;
        self.readyState = self.OPEN;
        self.onopen();
      }
    } else {
      self.onmessage(m);
    }
  };
}

SocksSocket.prototype.start = function() {
  this.step = 1;
  this.ws.send(new Uint8Array([0x05, 0x01, 0x00]));
};

SocksSocket.prototype.connect = function() {
  this.step = 2;
  var domain = (new TextEncoder()).encode(this.domain);

  var data = new Uint8Array(7 + domain.length);
  data[0] = 0x05;
  data[1] = 0x01;
  data[2] = 0x00;
  data[3] = 0x03;
  data[4] = domain.length;
  data.set(domain, 5);
  data[data.length - 2] = (this.port >> 8) & 0xFF;
  data[data.length - 1] = this.port & 0xFF;

  this.ws.send(data);
};

SocksSocket.prototype.send = function(x) {
  this.ws.send(x);
}

SocksSocket.prototype.close = function(x) {
  if (this.ws) {
    this.readyState = this.CLOSED;
    this.ws.close();
    this.ws = null;
  }
}

// This and SocksSocket is a fucking mess, need to refactor
function MyWebSocket(url, protocols) {
  var self = this;
  this.CONNECTING = 0;
  this.OPEN = 1;
  this.CLOSING = 2;
  this.CLOSED = 3;
  if (url.indexOf(bridge) === -1) {
    // TODO: refactor and clean this
    // Mocking this, we need to translate into socks protocol and forward to tor
    var host = url.slice(5); // TODO better way

    var domain = host.split(':')[0];
    var port = parseInt(host.split(':')[1] || 80);

    // This socket will be seen by tor
    var localSocket = {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3,
      _socket: {
        remoteAddress: randomIp(),
        remotePort: randomPort(),
      },
      send: function(data) {
        remoteSocket.onmessage({ data: data });
      },
      close: function() {
        if (localSocket.readyState !== localSocket.CLOSED) {
          localSocket.readyState = localSocket.CLOSED;
          localSocket.onclose();
          remoteSocket.close();
        }
      },
      readyState: 1,
    };

    var remoteSocket = {
      send: function(data) {
        localSocket.onmessage({ data: (data.buffer || data) });
      },
      close: function() {
        remoteSocket.onclose();
        localSocket.close();
      },
    };

    this.ws = new SocksSocket(remoteSocket, domain, port);

    this.ws.onmessage = function(m) {
      self.onmessage(m);
    };

    this.ws.onerror = function(e) {
      self.onerror(e);
    };

    this.ws.onclose = function() {
      self.onclose();
    };

    this.ws.onopen = function() {
      self.onopen();
    };

    server.listeners.connection(localSocket);
    remoteSocket.onopen();
  } else {
    this.ws = new WebSocket(url, protocols);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = function() {
      this.onopen();
    }.bind(this);

    this.ws.onclose = function() {
     this.onclose && this.onclose();
    }.bind(this);

    this.ws.onerror = function(e) {
     this.onerror && this.onerror(e);
    }.bind(this);

    this.ws.onmessage = function(m) {
     this.onmessage && this.onmessage(m);
    }.bind(this);
  }
}

MyWebSocket.prototype.send = function(data) {
  this.ws.send(data);
};

MyWebSocket.prototype.close = function() {
  this.ws.close();
};

MyWebSocket.prototype.__defineGetter__('readyState', function() {
  return this.ws.readyState;
});

// Module
Module.wasmBinary = xhr.response;
// Module.print = function() {};
Module.noInitialRun = true;
Module.WebSocket = MyWebSocket;
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
