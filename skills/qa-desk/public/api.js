// A failed fetch here (the network is down, or the server is not running) is the one
// signal the rest of the app has that the connection dropped. An HTTP error response still
// means the server answered, so only a thrown fetch reports offline; anything that comes
// back at all reports online again.
let reportConnection = () => {};
export function onConnection(fn) { reportConnection = fn; }

async function rawFetch(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch (err) {
    reportConnection(false);
    throw new Error(`${path}: ${err.message}`);
  }
  reportConnection(true);
  return res;
}

async function call(method, path, body) {
  const res = await rawFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 120)}`); }
  if (!json.ok) throw new Error(json.error ?? `${method} ${path} failed`);
  return json.data;
}

export const api = {
  get: (path) => call('GET', path),
  post: (path, body = {}) => call('POST', path, body),
  put: (path, body) => call('PUT', path, body),
  async text(path) {
    const res = await rawFetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.text();
  },
};
