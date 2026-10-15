import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepo, encodeContent, decodeContent } from '../lib/github.js';

const b64 = (v) => encodeContent(`${JSON.stringify(v, null, 2)}\n`);

function fakeGitHub(files) {
  // files: path -> { json, sha }
  const calls = [];
  let shaCounter = 0;
  const impl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body && JSON.parse(init.body), auth: init.headers?.authorization });
    const path = decodeURIComponent(new URL(url).pathname.replace(/^\/repos\/kem\/kems-list\/contents\//, ''));
    const f = files[path];
    if (method === 'GET') {
      if (!f) return new Response('{"message":"Not Found"}', { status: 404 });
      return Response.json({ sha: f.sha, content: b64(f.json), encoding: 'base64', size: 10 });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      if (f && body.sha !== f.sha) return Response.json({ message: `is at ${f.sha} but expected ${body.sha}` }, { status: 409 });
      files[path] = { json: JSON.parse(decodeContent(body.content)), sha: `sha${++shaCounter}` };
      return Response.json({ content: { sha: files[path].sha } });
    }
    return new Response('', { status: 405 });
  };
  return { impl, calls, files };
}

const repo = (impl) => createRepo({ owner: 'kem', repo: 'kems-list', branch: 'main', token: 'tok', fetchImpl: impl });

test('UTF-8 content survives base64 round trips', () => {
  const s = 'Ọlá Àdébáyọ̀ — “Lagos” 🌍\n';
  assert.equal(decodeContent(encodeContent(s)), s);
});

test('load reads every data file with its sha', async () => {
  const gh = fakeGitHub({ 'data/pieces.json': { json: [{ id: 'x' }], sha: 's1' }, 'data/skipped.json': { json: [], sha: 's2' } });
  const r = repo(gh.impl);
  const data = await r.load(['pieces', 'skipped']);
  assert.deepEqual(data, { pieces: [{ id: 'x' }], skipped: [] });
  assert.equal(gh.calls[0].auth, 'Bearer tok');
});

test('commit writes each change with the known sha and a message', async () => {
  const gh = fakeGitHub({ 'data/skipped.json': { json: [], sha: 's1' } });
  const r = repo(gh.impl);
  const data = await r.load(['skipped']);
  const result = await r.commit(data, { message: 'skip: T', changes: [{ file: 'skipped', apply: (cur) => [...cur, 'aaaaaaaaaaaa'] }] });
  assert.deepEqual(result.skipped, ['aaaaaaaaaaaa']);
  assert.deepEqual(gh.files['data/skipped.json'].json, ['aaaaaaaaaaaa']);
  const put = gh.calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.sha, 's1');
  assert.equal(put.body.message, 'skip: T');
  assert.equal(put.body.branch, 'main');
});

test('on a 409 conflict it re-fetches, re-applies the change to fresh data and retries', async () => {
  const gh = fakeGitHub({ 'data/pieces.json': { json: [], sha: 's1' } });
  const r = repo(gh.impl);
  const data = await r.load(['pieces']);
  gh.files['data/pieces.json'] = { json: [{ id: 'dddddddddddd' }], sha: 's-other' }; // someone else committed
  const result = await r.commit(data, { message: 'approve', changes: [{ file: 'pieces', apply: (cur) => [{ id: 'aaaaaaaaaaaa' }, ...cur] }] });
  assert.deepEqual(gh.files['data/pieces.json'].json.map((p) => p.id), ['aaaaaaaaaaaa', 'dddddddddddd']);
  assert.deepEqual(result.pieces.map((p) => p.id), ['aaaaaaaaaaaa', 'dddddddddddd']);
});

test('gives up after 3 conflicting attempts with a clear error', async () => {
  const gh = fakeGitHub({ 'data/pieces.json': { json: [], sha: 's1' } });
  const flaky = async (url, init = {}) => {
    if (init.method === 'PUT') return Response.json({ message: 'conflict' }, { status: 409 });
    return gh.impl(url, init);
  };
  const r = repo(flaky);
  const data = await r.load(['pieces']);
  await assert.rejects(r.commit(data, { message: 'm', changes: [{ file: 'pieces', apply: (c) => c }] }), /changed on GitHub 3 times/);
});

test('refuses to commit data that fails validation', async () => {
  const gh = fakeGitHub({ 'data/skipped.json': { json: [], sha: 's1' } });
  const r = repo(gh.impl);
  const data = await r.load(['skipped']);
  await assert.rejects(r.commit(data, { message: 'm', changes: [{ file: 'skipped', apply: () => ['not-an-id'] }] }, { validate: () => ['skipped[0]: bad'] }), /skipped\[0\]: bad/);
  assert.equal(gh.calls.filter((c) => c.method === 'PUT').length, 0);
});

test('bad tokens surface as an auth error', async () => {
  const r = repo(async () => new Response('{"message":"Bad credentials"}', { status: 401 }));
  await assert.rejects(r.load(['pieces']), /token was rejected/);
});
