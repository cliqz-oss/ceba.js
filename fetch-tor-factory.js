// TODO: something to wait for tor bootstrap?

function FetchTorFactory({ timeout = 10, bridge = '18.194.182.20:9999' }) {
  const worker = new Worker('tor.js');
  worker.postMessage({ action: 'run', bridge, timeout });

  const requests = {};

  worker.onmessage = (event) => {
    const data = event.data;
    if (data.action === 'response') {
      if (requests[data.id]) {
        if (data.error) {
          requests[data.id].reject(new TypeError(data.error));
        } else {
          requests[data.id].resolve(data.response);
        }
      }
    }
  };

  return function fetchTor(input, init) {
    const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    return (new Promise((resolve, reject) => {
      requests[id] = { resolve, reject };
      setTimeout(reject.bind(null, new TypeError('Timeout (client)')), 2 * timeout * 1000); // This one should never trigger...

      // TODO: implement other options...
      const request = new Request(input, init);
      const { url, method, headers } = request;

      request.arrayBuffer().then((x) => {
        worker.postMessage({
          id,
          action: 'request',
          request: {
            url,
            method,
            headers: [...headers.entries()],
            body: new Uint8Array(x),
          },
        });
      }).catch(reject);

    })).then((response) => {
      delete requests[id];
      if (!response.status) {
        throw new TypeError('Timeout or other network error');
      }
      const status = response.status;
      const statusText = response.statusText;
      const headers = new Headers(response.headers);
      return new Response(response.body, { status, statusText, headers });
    })
    .catch((e) => {
      delete requests[id]
      throw e;
    });
  }
}
