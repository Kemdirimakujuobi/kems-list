import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { build, renderIndex, renderPiece, renderFeed } from '../scripts/build.js';

const NOW = new Date('2026-10-15T12:00:00Z');
const cfg = { title: "Kem's List", description: 'The best writing by Africans online.', base: '/kems-list/', url: 'https://kemdirimakujuobi.github.io/kems-list' };
const piece = (id, approvedAt, extra = {}) => ({ id, url: `https://ada.substack.com/p/${id}`, title: `Title ${id}`, writerId: 'ada-okafor', publishedAt: '2026-10-01T00:00:00.000Z', approvedAt, excerpt: `Excerpt ${id}`, platform: 'Substack', readMinutes: 7, ...extra });
const data = () => ({
  writers: [{ id: 'ada-okafor', name: 'Ada Okafor', country: 'Nigeria', links: { substack: 'https://ada.substack.com' }, active: true, addedAt: '2026-09-01T00:00:00Z' }],
  inbox: [], skipped: [], queue: [], status: { feeds: {}, deadLinks: [], linkChecks: {} },
  pieces: [
    piece('aaaaaaaaaaaa', '2026-10-15T09:00:00.000Z', { note: 'Read this one slowly.' }),
    piece('bbbbbbbbbbbb', '2026-10-12T09:00:00.000Z'),
    piece('cccccccccccc', '2026-09-01T09:00:00.000Z', { writerId: undefined, url: 'https://mag.example/essay', platform: 'mag.example' }),
  ],
});

test('index groups pieces into Today / This week / Earlier, newest first', () => {
  const html = renderIndex(data(), cfg, NOW);
  const order = ['Today', 'Title aaaaaaaaaaaa', 'This week', 'Title bbbbbbbbbbbb', 'Earlier', 'Title cccccccccccc'].map((s) => html.indexOf(s));
  assert.ok(order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), JSON.stringify(order));
  assert.match(html, /href="\/kems-list\/p\/aaaaaaaaaaaa\/"/);
  assert.match(html, />Ada Okafor</);
  assert.match(html, />mag\.example</, 'pieces without a writer show their platform');
  assert.match(html, /href="\/kems-list\/feed\.xml"/);
});

test('empty index has a calm empty state', () => {
  assert.match(renderIndex({ ...data(), pieces: [] }, cfg, NOW), /Nothing here yet/);
});

test('piece page: writer, country, read time, note, excerpt, read-on button and OG tags', () => {
  const d = data();
  const html = renderPiece(d.pieces[0], d, cfg, { prev: null, next: d.pieces[1] });
  assert.match(html, /<h1[^>]*>Title aaaaaaaaaaaa<\/h1>/);
  assert.match(html, /Ada Okafor · Nigeria/);
  assert.match(html, /7 min read/);
  assert.match(html, /<blockquote[^>]*>Read this one slowly\.<\/blockquote>/);
  assert.match(html, /Excerpt aaaaaaaaaaaa/);
  assert.match(html, /<a[^>]+href="https:\/\/ada\.substack\.com\/p\/aaaaaaaaaaaa"[^>]*>Read on Substack →<\/a>/);
  assert.match(html, /<meta property="og:title" content="Title aaaaaaaaaaaa">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/kemdirimakujuobi\.github\.io\/kems-list\/p\/aaaaaaaaaaaa\/">/);
  assert.match(html, /data-next="\/kems-list\/p\/bbbbbbbbbbbb\/"/);
});

test('everything user-provided is escaped in HTML and RSS', () => {
  const d = data();
  d.pieces[0] = { ...d.pieces[0], title: '<script>alert(1)</script> & “quotes”', note: '"><img src=x onerror=1>', excerpt: 'a < b & c' };
  const index = renderIndex(d, cfg, NOW);
  const page = renderPiece(d.pieces[0], d, cfg, {});
  const feed = renderFeed(d, cfg);
  for (const out of [index, page, feed]) {
    assert.doesNotMatch(out, /<script>alert|<img src=x/);
  }
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; “quotes”/);
  assert.match(page, /&quot;&gt;&lt;img src=x onerror=1&gt;/);
});

test('feed.xml is valid RSS with the newest 50 items, note before excerpt', () => {
  const d = data();
  d.pieces = Array.from({ length: 60 }, (_, i) => piece(i.toString(16).padStart(12, '0'), new Date(NOW - i * 3600e3).toISOString(), i === 0 ? { note: 'Kem says read it.' } : {}));
  const rss = new XMLParser({ ignoreAttributes: false }).parse(renderFeed(d, cfg)).rss.channel;
  assert.equal(rss.title, "Kem's List");
  assert.equal(rss.item.length, 50);
  assert.equal(rss.item[0].link, d.pieces[0].url);
  assert.match(rss.item[0].description, /^Kem says read it\./);
  assert.equal(rss.item[0].guid['#text'], `${cfg.url}/p/${d.pieces[0].id}/`);
});

test('build writes the whole site, and refuses invalid data', async () => {
  const out = mkdtempSync(join(tmpdir(), 'kems-'));
  await build({ data: data(), outDir: out, config: cfg, now: NOW });
  for (const f of ['index.html', 'p/aaaaaaaaaaaa/index.html', 'feed.xml', '404.html', '.nojekyll', 'assets/style.css', 'assets/keys.js', 'desk/index.html', 'desk/desk.js', 'lib/desk.js', 'lib/github.js', 'lib/schema.js']) {
    assert.ok(existsSync(join(out, f)), f);
  }
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /Title aaaaaaaaaaaa/);
  const bad = data();
  bad.pieces[0].url = 'javascript:alert(1)';
  await assert.rejects(build({ data: bad, outDir: mkdtempSync(join(tmpdir(), 'kems-')), config: cfg, now: NOW }), /pieces\[0\]\.url/);
});
