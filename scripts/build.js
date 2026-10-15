// Builds the public site into _site/: index, one page per piece, feed.xml, plus the static desk.
// Usage: node scripts/build.js   (env SITE_BASE / SITE_URL override the GitHub Pages defaults)
import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateData } from '../lib/schema.js';

export const CONFIG = {
  title: "Kem's List",
  description: 'The best writing by Africans on the internet, chosen one piece at a time.',
  base: process.env.SITE_BASE ?? '/kems-list/',
  url: (process.env.SITE_URL ?? 'https://kemdirimakujuobi.github.io/kems-list').replace(/\/$/, ''),
};

const ROOT = new URL('../', import.meta.url);
const DAY = 24 * 3600 * 1000;
const FEED_SIZE = 50;

/* ---------- helpers ---------- */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso, now) {
  const d = new Date(iso);
  const s = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? s : `${s} ${d.getUTCFullYear()}`;
}
const longDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const byApproved = (a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt);
const pieceHref = (cfg, p) => `${cfg.base}p/${p.id}/`;
const writerOf = (data, p) => data.writers.find((w) => w.id === p.writerId) ?? null;
const sourceName = (data, p) => writerOf(data, p)?.name ?? p.platform;

function layout(cfg, { title, description, path, body, bodyAttrs = '', type = 'website' }) {
  const fullTitle = title ? `${title} · ${cfg.title}` : cfg.title;
  const url = `${cfg.url}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<link rel="alternate" type="application/rss+xml" title="${esc(cfg.title)}" href="${cfg.base}feed.xml">
<meta property="og:site_name" content="${esc(cfg.title)}">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title || cfg.title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta name="twitter:card" content="summary">
<link rel="stylesheet" href="${cfg.base}assets/style.css">
<script src="${cfg.base}assets/keys.js" defer></script>
</head>
<body${bodyAttrs}>
<header class="top"><a class="brand" href="${cfg.base}">${esc(cfg.title)}</a><nav><a href="${cfg.base}feed.xml">RSS</a></nav></header>
${body}
</body>
</html>
`;
}

/* ---------- pages ---------- */

function groupOf(p, now) {
  const t = Date.parse(p.approvedAt);
  if (new Date(t).toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return 'Today';
  if (now - t < 7 * DAY) return 'This week';
  return 'Earlier';
}

export function renderIndex(data, cfg, now = new Date()) {
  const pieces = [...data.pieces].sort(byApproved);
  let body;
  if (pieces.length === 0) {
    body = '<main class="list"><div class="empty"><p class="empty-title">Nothing here yet</p><p>The first pieces are being chosen.</p></div></main>';
  } else {
    const groups = new Map();
    for (const p of pieces) {
      const g = groupOf(p, now);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    body = `<main class="list">
<p class="intro">${esc(cfg.description)}</p>
${[...groups].map(([name, list]) => `<section>
<h2 class="group">${name}</h2>
<ol class="rows">
${list.map((p) => {
  const from = sourceName(data, p);
  return `<li><a class="row" href="${pieceHref(cfg, p)}"><span class="avatar" aria-hidden="true">${esc(from.trim()[0]?.toUpperCase() ?? '·')}</span><span class="from">${esc(from)}</span><span class="subject"><strong>${esc(p.title)}</strong>${p.excerpt ? `<span class="snippet"> — ${esc(p.excerpt)}</span>` : ''}</span><time datetime="${esc(p.publishedAt)}">${shortDate(p.publishedAt, now)}</time></a></li>`;
}).join('\n')}
</ol>
</section>`).join('\n')}
</main>`;
  }
  return layout(cfg, { title: '', description: cfg.description, path: '/', body });
}

export function renderPiece(p, data, cfg, { prev, next } = {}) {
  const writer = writerOf(data, p);
  const byline = writer ? [writer.name, writer.country].filter(Boolean).join(' · ') : p.platform;
  const meta = [longDate(p.publishedAt), p.readMinutes ? `${p.readMinutes} min read` : null, p.platform].filter(Boolean).join(' · ');
  const follow = writer ? Object.values(writer.links)[0] : null;
  const attrs = [` data-home="${cfg.base}"`, prev ? ` data-prev="${pieceHref(cfg, prev)}"` : '', next ? ` data-next="${pieceHref(cfg, next)}"` : ''].join('');
  const body = `<main class="reader">
<article>
<h1 class="title">${esc(p.title)}</h1>
<p class="byline">${esc(byline)}</p>
<p class="meta">${esc(meta)}</p>
${p.note ? `<figure class="note"><blockquote class="note-text">${esc(p.note)}</blockquote><figcaption>Kem's note</figcaption></figure>` : ''}
${p.excerpt ? `<p class="excerpt">${esc(p.excerpt)}</p>` : ''}
<p class="actions"><a class="read" href="${esc(p.url)}" rel="noopener">Read on ${esc(p.platform)} →</a></p>
${follow ? `<p class="follow"><a href="${esc(follow)}" rel="noopener">More from ${esc(writer.name)}</a></p>` : ''}
</article>
<nav class="pager">${prev ? `<a href="${pieceHref(cfg, prev)}">← Newer</a>` : '<span></span>'}<a href="${cfg.base}">All pieces</a>${next ? `<a href="${pieceHref(cfg, next)}">Older →</a>` : '<span></span>'}</nav>
</main>`;
  return layout(cfg, { title: p.title, description: p.note || p.excerpt || `${p.title}, by ${byline}`, path: `/p/${p.id}/`, body, bodyAttrs: attrs, type: 'article' });
}

export function renderFeed(data, cfg) {
  const items = [...data.pieces].sort(byApproved).slice(0, FEED_SIZE);
  const xml = (s) => esc(s);
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>${xml(cfg.title)}</title>
<link>${xml(`${cfg.url}/`)}</link>
<description>${xml(cfg.description)}</description>
<language>en</language>
<atom:link href="${xml(`${cfg.url}/feed.xml`)}" rel="self" type="application/rss+xml"/>
${items.map((p) => `<item>
<title>${xml(p.title)}</title>
<link>${xml(p.url)}</link>
<guid isPermaLink="true">${xml(`${cfg.url}/p/${p.id}/`)}</guid>
<pubDate>${new Date(p.approvedAt).toUTCString()}</pubDate>
<dc:creator>${xml(sourceName(data, p))}</dc:creator>
<description>${xml([p.note, p.excerpt].filter(Boolean).join('\n\n'))}</description>
</item>`).join('\n')}
</channel>
</rss>
`;
}

function render404(cfg) {
  return layout(cfg, { title: 'Not found', description: cfg.description, path: '/404.html', body: `<main class="list"><div class="empty"><p class="empty-title">That page isn't here</p><p><a href="${cfg.base}">Back to the list</a></p></div></main>` });
}

/* ---------- build ---------- */

export async function build({ data, outDir, config = CONFIG, now = new Date() }) {
  const errors = validateData(data);
  if (errors.length) throw new Error(`Invalid data, not building:\n${errors.join('\n')}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const write = async (rel, content) => { await mkdir(join(outDir, rel, '..'), { recursive: true }); await writeFile(join(outDir, rel), content); };

  const pieces = [...data.pieces].sort(byApproved);
  await write('index.html', renderIndex(data, config, now));
  await Promise.all(pieces.map((p, i) => write(`p/${p.id}/index.html`, renderPiece(p, data, config, { prev: pieces[i - 1], next: pieces[i + 1] }))));
  await write('feed.xml', renderFeed(data, config));
  await write('404.html', render404(config));
  await write('.nojekyll', '');

  const src = (rel) => fileURLToPath(new URL(rel, ROOT));
  await cp(src('site/assets'), join(outDir, 'assets'), { recursive: true });
  await cp(src('site/desk'), join(outDir, 'desk'), { recursive: true });
  await cp(src('lib'), join(outDir, 'lib'), { recursive: true, filter: (f) => !f.endsWith('.test.js') });
  return { pages: pieces.length + 2 };
}

async function main() {
  const names = ['writers', 'inbox', 'pieces', 'skipped', 'queue', 'status'];
  const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, JSON.parse(await readFile(new URL(`data/${n}.json`, ROOT), 'utf8'))])));
  const outDir = fileURLToPath(new URL('_site', ROOT));
  const { pages } = await build({ data, outDir });
  console.log(`built ${pages} pages → _site/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
