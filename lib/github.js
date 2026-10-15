// Tiny GitHub Contents API client for the desk: load data/*.json and commit desk actions.
// Runs in the browser (and Node for tests). Conflicts are handled by re-applying the action to fresh data.

const API = 'https://api.github.com';
const MAX_ATTEMPTS = 3;

export function encodeContent(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function decodeContent(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function createRepo({ owner, repo, branch = 'main', token, fetchImpl = (...a) => fetch(...a) }) {
  const shas = new Map();
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' };
  const pathOf = (name) => `data/${name}.json`;

  async function request(url, init = {}) {
    const res = await fetchImpl(url, { ...init, headers: { ...headers, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    if (res.status === 401 || res.status === 403) throw new Error('Your GitHub token was rejected. Check it has Contents read & write on this repo.');
    return res;
  }

  async function get(name) {
    const res = await request(`${API}/repos/${owner}/${repo}/contents/${pathOf(name)}?ref=${encodeURIComponent(branch)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Couldn't read ${pathOf(name)} (HTTP ${res.status}).`);
    const meta = await res.json();
    let content = meta.content;
    if (!content && meta.size > 0) { // files over 1 MB come back without content; fetch the blob instead
      const blob = await request(`${API}/repos/${owner}/${repo}/git/blobs/${meta.sha}`);
      content = (await blob.json()).content;
    }
    shas.set(name, meta.sha);
    return JSON.parse(decodeContent(content));
  }

  async function load(names) {
    const entries = await Promise.all(names.map(async (n) => [n, await get(n)]));
    return Object.fromEntries(entries);
  }

  async function put(name, value, message) {
    const res = await request(`${API}/repos/${owner}/${repo}/contents/${pathOf(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: encodeContent(serialize(value)), sha: shas.get(name), branch }),
    });
    if (res.status === 409 || res.status === 422) return { conflict: true };
    if (!res.ok) throw new Error(`Couldn't save ${pathOf(name)} (HTTP ${res.status}).`);
    shas.set(name, (await res.json()).content.sha);
    return { conflict: false };
  }

  // Applies each change of a desk action and commits it; returns the updated data.
  async function commit(data, action, { validate } = {}) {
    const current = { ...data };
    for (const { file, apply } of action.changes) {
      for (let attempt = 1; ; attempt++) {
        const next = apply(current[file]);
        const errors = validate ? validate({ ...current, [file]: next }) : [];
        if (errors.length) throw new Error(`Not saved, the data would be invalid:\n${errors.join('\n')}`);
        const { conflict } = await put(file, next, action.message);
        if (!conflict) { current[file] = next; break; }
        if (attempt >= MAX_ATTEMPTS) throw new Error(`${pathOf(file)} changed on GitHub ${MAX_ATTEMPTS} times while saving. Reload and try again.`);
        current[file] = await get(file);
      }
    }
    return current;
  }

  return { load, commit };
}
