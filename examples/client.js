const net = require('net');
const Module = require('../build/tor');

class TcpSocket {
  static get CONNECTING() {
    return 0;
  }
  static get OPEN() {
    return 1;
  }
  static get CLOSING() {
    return 2;
  }
  static get CLOSED() {
    return 3;
  }

  constructor(socket, remoteAddress, remotePort) {
    // Seems that WebSockets have these both in prototype and as 'static' properties.
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSING = 2;
    this.CLOSED = 3;

    this.socket = socket;
    this.readyState = TcpSocket.CONNECTING;
    this._socket = {
      remoteAddress,
      remotePort,
    };

    this.socket.on('data', (data) => {
      if (this.onmessage) {
        this.onmessage({ data });
      }
    });

    this.socket.on('close', () => {
      this.close();
    });

    this.socket.on('error', (e) => {
      if (this.onerror) {
        this.onerror(e);
      }
    });

    this.socket.on('connect', () => {
      this.readyState = TcpSocket.OPEN;
      if (this.onopen) {
        this.onopen();
      }
    });

    // error?
  }

  send(data) {
    this.socket.write(Buffer.from(data));
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.readyState = TcpSocket.CLOSED; // Should be CLOSING?
    this.socket.end(); // Half-closed?
    delete this.socket;
    if (this.onclose) {
      this.onclose();
    }
  }
}

class TcpSocketWrapper extends TcpSocket {
  constructor(url) {
    let host;
    let port;
    if (url.indexOf('ws://') === 0) {
      const sp = (url.slice(5).split('/')[0] || '').split(':');
      host = sp[0];
      port = parseInt(sp[1], 10);
    }

    if (!host || !Number.isInteger(port)) {
      // printErr('Tried to create socket with wrong host or port ' + url + ' ' + protocols);
      throw new Error('Invalid host or port for socket');
    }
    const socket = new net.Socket();
    socket.connect(port, host);
    super(socket, host, port);
  }
}


class SocketServer {
  constructor(config) {
    if (!config || config.host !== '127.0.0.1' || typeof config.port !== 'number') {
      throw new Error(`Wrong listening server ${(config && config.port)}`);
    }
    this.config = config;
    this.listeners = {};
    this.server = net.createServer((socket) => {
      let remoteAddress = socket.remoteAddress;
      if (remoteAddress.indexOf('::ffff:') === 0) {
        remoteAddress = remoteAddress.slice(7);
      }
      const _socket = new TcpSocket(socket, remoteAddress, socket.remotePort);
      _socket.readyState = TcpSocket.OPEN;
      this.listeners.connection(_socket);
    });
    this.server.listen(config.port, config.port);
  }

  on(name, cb) {
    this.listeners[name] = cb;
  }

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.server.close();
    delete this.server;
    delete this.listeners;
    delete this.config;
  }
}

const instance = Module({
  CustomSocketServer: SocketServer,
  CustomSocket: TcpSocketWrapper,
  arguments: process.argv.slice(2),
});
