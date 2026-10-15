// Discovery job: watch every active writer's feeds and pasted links, fill data/queue.json for the desk.
// Owns data/queue.json and data/status.json only. Usage: node scripts/discover.js [--weekly]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { idFor, canonicalUrl } from './lib/canonical.js';
import { discoverFeedUrl, fetchText, parseFeed, toCandidate, pageMeta, excerptOf, platformOf, USER_AGENT } from './lib/feeds.js';

const SEED_COUNT = 3;

export async function discover({ data, fetchImpl = fetch, now = new Date(), weekly = false, log = () => {} }) {
  const status = structuredClone(data.status ?? {});
  status.feeds ??= {};
  status.deadLinks ??= [];
  status.linkChecks ??= {};

  const decided = new Set([...data.pieces.map((p) => p.id), ...data.skipped]);
  const queue = data.queue.filter((q) => !decided.has(q.id));
  const queued = new Set(queue.map((q) => q.id));
  const add = (c) => { if (c && !decided.has(c.id) && !queued.has(c.id)) { queue.push(c); queued.add(c.id); } };

  // 1. Writers' feeds
  for (const writer of data.writers.filter((w) => w.active)) {
    for (const [kind, link] of Object.entries(writer.links)) {
      const key = `${writer.id}:${kind}`;
      const entry = (status.feeds[key] ??= { failCount: 0 });
      try {
        entry.feedUrl ??= await discoverFeedUrl(link, fetchImpl);
        if (!entry.feedUrl) throw new Error('no feed found at this link');
        const feed = parseFeed(await fetchText(entry.feedUrl, fetchImpl));
        let candidates = feed.items.map((item) => toCandidate(item, { writerId: writer.id, now, feed })).filter(Boolean);
        if (!entry.lastOk) candidates = candidates.sort(byNewest).slice(0, SEED_COUNT);
        candidates.forEach(add);
        entry.lastOk = now.toISOString();
        entry.failCount = 0;
        delete entry.lastError;
      } catch (err) {
        entry.failCount = (entry.failCount ?? 0) + 1;
        entry.lastError = `${now.toISOString().slice(0, 10)}: ${err.message}`;
        log(`feed failed ${key}: ${err.message}`);
      }
    }
  }

  // 2. Links pasted in the desk
  for (const { url: raw } of data.inbox) {
    const url = canonicalUrl(raw);
    if (!url) continue;
    const id = idFor(url);
    if (decided.has(id) || queued.has(id)) continue;
    let meta = {};
    try { meta = pageMeta(await fetchText(url, fetchImpl)); } catch (err) { log(`inbox fetch failed ${url}: ${err.message}`); }
    const u = new URL(url);
    const writerId = matchWriter(url, data.writers);
    add({
      id,
      url,
      title: meta.title || `${u.host.replace(/^www\./, '')}${u.pathname}`.replace(/\/$/, ''),
      ...(writerId ? { writerId } : {}),
      publishedAt: meta.publishedAt || now.toISOString(),
      ...(meta.description ? { excerpt: excerptOf(meta.description) } : {}),
      platform: platformOf(url),
      paywalled: false,
      foundAt: now.toISOString(),
    });
  }

  // 3. Weekly: flag published links that have disappeared (two strikes; never unpublishes)
  if (weekly) {
    for (const piece of data.pieces) {
      let gone = false;
      try {
        const res = await fetchImpl(piece.url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
        gone = res.status === 404 || res.status === 410;
        res.body?.cancel?.();
      } catch { continue; } // network trouble is not evidence
      if (gone) status.linkChecks[piece.id] = (status.linkChecks[piece.id] ?? 0) + 1;
      else delete status.linkChecks[piece.id];
    }
    status.deadLinks = data.pieces.map((p) => p.id).filter((id) => (status.linkChecks[id] ?? 0) >= 2);
  }

  return { queue: queue.sort(byNewest), status };
}

const byNewest = (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt);

function matchWriter(url, writers) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  for (const w of writers) {
    for (const link of Object.values(w.links)) {
      let l;
      try { l = new URL(link); } catch { continue; }
      const lhost = l.hostname.replace(/^www\./, '');
      const seg = l.pathname.split('/').filter(Boolean)[0];
      if (lhost === 'medium.com') { if (host === 'medium.com' && seg && u.pathname.startsWith(`/${seg}`)) return w.id; }
      else if (lhost === 'substack.com') { if (seg?.startsWith('@') && host === `${seg.slice(1)}.substack.com`) return w.id; }
      else if (lhost === host) return w.id;
    }
  }
  return null;
}

/* ---------- CLI ---------- */

const DATA = new URL('../data/', import.meta.url);
const read = async (name) => JSON.parse(await readFile(new URL(`${name}.json`, DATA), 'utf8'));
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

async function main() {
  const names = ['writers', 'inbox', 'pieces', 'skipped', 'queue', 'status'];
  const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await read(n)])));
  const weekly = process.argv.includes('--weekly');
  const { queue, status } = await discover({ data, weekly, log: (m) => console.log(m) });
  for (const [name, value] of [['queue', queue], ['status', status]]) {
    const before = json(data[name]);
    const after = json(value);
    if (before !== after) await writeFile(new URL(`${name}.json`, DATA), after);
  }
  const failing = Object.entries(status.feeds).filter(([, s]) => s.failCount > 0).length;
  console.log(`queue: ${queue.length} · feeds: ${Object.keys(status.feeds).length} (${failing} failing)${weekly ? ` · dead links: ${status.deadLinks.length}` : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
