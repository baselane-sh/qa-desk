async function call(method, path, body) {
  const res = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
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
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.text();
  },
};
