// Local preview: serves _site at /kems-list/ and a fake GitHub Contents API at /__github__ so the desk
// can be tried end to end without a token. Data lives in a scratch folder (DEV_DATA), never in data/.
// Usage: DEV_DATA=/tmp/kems-data node scripts/serve.js   → http://localhost:4173/kems-list/desk/
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, CONFIG } from './build.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(ROOT, '_site');
const DATA = process.env.DEV_DATA || join(ROOT, '.dev-data');
const PORT = Number(process.env.PORT || 4173);
const BASE = '/kems-list/';
const FILES = ['writers', 'inbox', 'pieces', 'skipped', 'queue', 'status'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.xml': 'application/xml', '.json': 'application/json' };

const sha = (text) => createHash('sha1').update(text).digest('hex');

async function rebuild() {
  const data = Object.fromEntries(await Promise.all(FILES.map(async (n) => [n, JSON.parse(await readFile(join(DATA, `${n}.json`), 'utf8'))])));
  await build({ data, outDir: SITE, config: { ...CONFIG, base: BASE, url: `http://localhost:${PORT}/kems-list` }, iconFetch: (...a) => fetch(...a) });
}

async function fakeGitHub(req, res, path) {
  const name = path.match(/\/contents\/data\/([a-z]+)\.json$/)?.[1];
  if (!name || !FILES.includes(name)) { res.writeHead(404).end('{"message":"Not Found"}'); return; }
  const file = join(DATA, `${name}.json`);
  const text = await readFile(file, 'utf8');
  if (req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sha: sha(text), size: text.length, content: Buffer.from(text).toString('base64') }));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const { sha: expected, content, message } = JSON.parse(body);
  if (expected !== sha(text)) { res.writeHead(409).end(JSON.stringify({ message: 'sha mismatch' })); return; }
  const next = Buffer.from(content, 'base64').toString('utf8');
  await writeFile(file, next);
  console.log(`commit: ${message}`);
  await rebuild();
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: { sha: sha(next) } }));
}

async function serveFile(res, path) {
  let rel = normalize(decodeURIComponent(path.slice(BASE.length))).replace(/^(\.\.[/\\])+/, '');
  let file = join(SITE, rel);
  if (existsSync(file) && (await stat(file)).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) { res.writeHead(404, { 'content-type': TYPES['.html'] }).end(await readFile(join(SITE, '404.html'))); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(file));
}

async function main() {
  if (!existsSync(join(DATA, 'pieces.json'))) { await mkdir(DATA, { recursive: true }); await cp(join(ROOT, 'data'), DATA, { recursive: true }); }
  await rebuild();
  createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://x');
      if (pathname.startsWith('/__github__/')) return await fakeGitHub(req, res, pathname);
      if (pathname === '/' || pathname === '/kems-list') { res.writeHead(302, { location: BASE }).end(); return; }
      if (pathname.startsWith(BASE)) return await serveFile(res, pathname);
      res.writeHead(404).end();
    } catch (err) {
      console.error(err);
      res.writeHead(500).end(String(err.message));
    }
  }).listen(PORT, () => console.log(`Kem's List preview → http://localhost:${PORT}${BASE}  (desk: ${BASE}desk/, data: ${DATA})`));
}

main();
