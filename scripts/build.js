// Builds the public site into _site/: index, one page per piece, feed.xml, plus the static desk.
// Usage: node scripts/build.js   (env SITE_BASE / SITE_URL override the GitHub Pages defaults)
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateData } from '../lib/schema.js';
import { languageOf, LANGUAGE_NAMES } from '../lib/lang.js';

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
const byApproved = (a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt);
const writerOf = (data, p) => data.writers.find((w) => w.id === p.writerId) ?? null;
const sourceName = (data, p) => writerOf(data, p)?.name ?? p.source ?? p.platform;
const iconOf = (data, p, icons) => [p.icon, writerOf(data, p)?.icon].map((u) => u && icons[u]).find(Boolean) ?? null;

function avatar(cfg, data, p, icons) {
  const local = iconOf(data, p, icons);
  if (local) return `<img class="avatar" src="${cfg.base}${local}" alt="" width="28" height="28" loading="lazy">`;
  return `<span class="avatar" aria-hidden="true">${esc(sourceName(data, p).trim()[0]?.toUpperCase() ?? '·')}</span>`;
}

// English is the default and goes untagged; any other language gets a small tag, and the title its lang.
function titleWithLang(p) {
  const lang = p.lang ?? languageOf(`${p.title} ${p.excerpt ?? ''}`);
  if (lang === 'en') return `<strong>${esc(p.title)}</strong>`;
  const name = LANGUAGE_NAMES[lang] ?? lang.toUpperCase();
  return `<strong lang="${esc(lang)}">${esc(p.title)}</strong><span class="lang" title="In ${esc(name)}">${esc(lang.toUpperCase())}</span>`;
}

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
<link rel="stylesheet" href="${cfg.base}assets/style.css${cfg.version ? `?v=${cfg.version}` : ''}">
<script src="${cfg.base}assets/keys.js${cfg.version ? `?v=${cfg.version}` : ''}" defer></script>
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

export function renderIndex(data, cfg, now = new Date(), icons = {}) {
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
  return `<li><a class="row" href="${esc(p.url)}" target="_blank" rel="noopener">${avatar(cfg, data, p, icons)}<span class="subject">${titleWithLang(p)}</span><span class="from">${esc(sourceName(data, p))}</span><time datetime="${esc(p.publishedAt)}">${shortDate(p.publishedAt, now)}</time></a></li>`;
}).join('\n')}
</ol>
</section>`).join('\n')}
</main>`;
  }
  return layout(cfg, { title: '', description: cfg.description, path: '/', body });
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
<guid isPermaLink="true">${xml(p.url)}</guid>
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

/* ---------- icons ---------- */

const ICON_MAX_BYTES = 300 * 1024;
const ICON_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };

// Substack images can be resized by its CDN: ask for a small square PNG instead of the original.
export function iconSourceUrl(url) {
  const fetched = url.match(/^https:\/\/substackcdn\.com\/image\/fetch\/[^/]+\/(https?%3A.*)$/i);
  if (fetched) return `https://substackcdn.com/image/fetch/w_96,h_96,c_fill,f_png/${fetched[1]}`;
  if (/^https:\/\/substack-post-media\.s3\.amazonaws\.com\//.test(url)) return `https://substackcdn.com/image/fetch/w_96,h_96,c_fill,f_png/${encodeURIComponent(url)}`;
  return url;
}

// Downloads every icon once into outDir/icons/. Returns { originalUrl: 'icons/<hash>.<ext>' }; failures are skipped.
async function downloadIcons(urls, outDir, iconFetch) {
  const icons = {};
  await mkdir(join(outDir, 'icons'), { recursive: true });
  await Promise.all([...new Set(urls)].map(async (url) => {
    try {
      const res = await iconFetch(iconSourceUrl(url), { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'KemsList/1.0' } });
      const ext = ICON_TYPES[(res.headers.get('content-type') || '').split(';')[0].trim()];
      if (!res.ok || !ext) return;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > ICON_MAX_BYTES) return;
      const name = `icons/${createHash('sha1').update(url).digest('hex').slice(0, 12)}.${ext}`;
      await writeFile(join(outDir, name), bytes);
      icons[url] = name;
    } catch { /* no icon: the row shows an initial */ }
  }));
  return icons;
}

/* ---------- build ---------- */

// A short hash of every shipped asset, appended as ?v= so browsers never serve a stale desk or stylesheet
// after a deploy (GitHub Pages sends max-age=600).
async function assetVersion() {
  const hash = createHash('sha1');
  for (const dir of ['site/assets', 'site/desk', 'lib']) {
    const files = (await readdir(fileURLToPath(new URL(dir, ROOT)))).filter((f) => !f.startsWith('.')).sort();
    for (const f of files) hash.update(f).update(await readFile(fileURLToPath(new URL(`${dir}/${f}`, ROOT))));
  }
  return hash.digest('hex').slice(0, 10);
}

export async function build({ data, outDir, config = CONFIG, now = new Date(), iconFetch = null }) {
  config = { ...config, version: await assetVersion() };
  const errors = validateData(data);
  if (errors.length) throw new Error(`Invalid data, not building:\n${errors.join('\n')}`);

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const write = async (rel, content) => { await mkdir(join(outDir, rel, '..'), { recursive: true }); await writeFile(join(outDir, rel), content); };

  const pieces = [...data.pieces].sort(byApproved);
  const iconUrls = [...pieces.map((p) => p.icon), ...data.writers.map((w) => w.icon)].filter(Boolean);
  const icons = iconFetch ? await downloadIcons(iconUrls, outDir, iconFetch) : {};
  await write('index.html', renderIndex(data, config, now, icons));
  await write('feed.xml', renderFeed(data, config));
  await write('404.html', render404(config));
  await write('.nojekyll', '');

  const src = (rel) => fileURLToPath(new URL(rel, ROOT));
  await cp(src('site/assets'), join(outDir, 'assets'), { recursive: true });
  await cp(src('site/desk'), join(outDir, 'desk'), { recursive: true });
  await cp(src('lib'), join(outDir, 'lib'), { recursive: true, filter: (f) => !f.endsWith('.test.js') });

  // version the desk's own references (module imports included) to match
  const v = config.version;
  const deskHtml = join(outDir, 'desk/index.html');
  await writeFile(deskHtml, (await readFile(deskHtml, 'utf8')).replace('../assets/style.css"', `../assets/style.css?v=${v}"`).replace('./desk.js"', `./desk.js?v=${v}"`));
  const deskJs = join(outDir, 'desk/desk.js');
  await writeFile(deskJs, (await readFile(deskJs, 'utf8')).replace(/'\.\.\/lib\/([\w-]+)\.js'/g, `'../lib/$1.js?v=${v}'`));
  return { pages: 2 };
}

async function main() {
  const names = ['writers', 'inbox', 'pieces', 'skipped', 'queue', 'status'];
  const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, JSON.parse(await readFile(new URL(`data/${n}.json`, ROOT), 'utf8'))])));
  const outDir = fileURLToPath(new URL('_site', ROOT));
  const { pages } = await build({ data, outDir, iconFetch: (...a) => fetch(...a) });
  console.log(`built ${pages} pages → _site/`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
