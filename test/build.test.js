import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { build, renderIndex, renderFeed, iconSourceUrl } from '../scripts/build.js';

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
  assert.match(html, /<a class="row" href="https:\/\/ada\.substack\.com\/p\/aaaaaaaaaaaa" target="_blank" rel="noopener">/);
  assert.match(html, />Ada Okafor</);
  assert.match(html, />mag\.example</, 'pieces without a writer show their platform');
  assert.match(html, /href="\/kems-list\/feed\.xml"/);
});

test('empty index has a calm empty state', () => {
  assert.match(renderIndex({ ...data(), pieces: [] }, cfg, NOW), /Nothing here yet/);
});

test('everything user-provided is escaped in HTML and RSS', () => {
  const d = data();
  d.pieces[0] = { ...d.pieces[0], title: '<script>alert(1)</script> & “quotes”', note: '"><img src=x onerror=1>', excerpt: 'a < b & c' };
  const index = renderIndex(d, cfg, NOW);
  const feed = renderFeed(d, cfg);
  for (const out of [index, feed]) {
    assert.doesNotMatch(out, /<script>alert|<img src=x/);
  }
  assert.match(index, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; “quotes”/);
  assert.match(feed, /&quot;&gt;&lt;img src=x onerror=1&gt;/);
});

test('feed.xml is valid RSS with the newest 50 items, note before excerpt', () => {
  const d = data();
  d.pieces = Array.from({ length: 60 }, (_, i) => piece(i.toString(16).padStart(12, '0'), new Date(NOW - i * 3600e3).toISOString(), i === 0 ? { note: 'Kem says read it.' } : {}));
  const rss = new XMLParser({ ignoreAttributes: false }).parse(renderFeed(d, cfg)).rss.channel;
  assert.equal(rss.title, "Kem's List");
  assert.equal(rss.item.length, 50);
  assert.equal(rss.item[0].link, d.pieces[0].url);
  assert.match(rss.item[0].description, /^Kem says read it\./);
  assert.equal(rss.item[0].guid['#text'], d.pieces[0].url);
});

test('build writes the whole site, and refuses invalid data', async () => {
  const out = mkdtempSync(join(tmpdir(), 'kems-'));
  await build({ data: data(), outDir: out, config: cfg, now: NOW });
  assert.equal(existsSync(join(out, 'p')), false, 'no per-piece pages');
  for (const f of ['index.html', 'feed.xml', '404.html', '.nojekyll', 'assets/style.css', 'assets/keys.js', 'desk/index.html', 'desk/desk.js', 'lib/desk.js', 'lib/github.js', 'lib/schema.js']) {
    assert.ok(existsSync(join(out, f)), f);
  }
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /Title aaaaaaaaaaaa/);
  const bad = data();
  bad.pieces[0].url = 'javascript:alert(1)';
  await assert.rejects(build({ data: bad, outDir: mkdtempSync(join(tmpdir(), 'kems-')), config: cfg, now: NOW }), /pieces\[0\]\.url/);
});

test('rows read: icon, title, source, publish date — no excerpt', () => {
  const d = data();
  d.pieces = [piece('dddddddddddd', '2026-10-15T09:00:00.000Z', { writerId: undefined, source: 'Dianne_-_', author: 'Dianne_-_', icon: 'https://substackcdn.com/a.jpg', publishedAt: '2026-10-11T07:39:15.000Z' })];
  const html = renderIndex(d, cfg, NOW, { 'https://substackcdn.com/a.jpg': 'icons/abc.png' });
  const row = html.match(/<a class="row"[\s\S]*?<\/a>/)[0];
  assert.doesNotMatch(row, /Excerpt dddddddddddd|snippet/);
  const order = ['<img class="avatar" src="/kems-list/icons/abc.png"', 'Title dddddddddddd', 'Dianne_-_', '11 Oct'].map((x) => row.indexOf(x));
  assert.ok(order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])), `${order} in ${row}`);
});

test('rows without a downloaded icon fall back to the initial', () => {
  const html = renderIndex(data(), cfg, NOW, {});
  assert.match(html, /<span class="avatar" aria-hidden="true">A<\/span>/);
});

test('source name: writer, then captured source, then platform', () => {
  const d = data();
  d.pieces = [piece('aaaaaaaaaaaa', '2026-10-15T09:00:00.000Z'), piece('bbbbbbbbbbbb', '2026-10-15T08:00:00.000Z', { writerId: undefined, source: 'Pub Name' }), piece('cccccccccccc', '2026-10-15T07:00:00.000Z', { writerId: undefined })];
  const html = renderIndex(d, cfg, NOW, {});
  assert.match(html, /class="from">Ada Okafor</);
  assert.match(html, /class="from">Pub Name</);
  assert.match(html, /class="from">Substack</);
});

test("iconSourceUrl asks Substack's CDN for a small square version", () => {
  assert.equal(iconSourceUrl('https://substackcdn.com/image/fetch/$s_!6eMR!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff2ff.jpeg'),
    'https://substackcdn.com/image/fetch/w_96,h_96,c_fill,f_png/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ff2ff.jpeg');
  assert.equal(iconSourceUrl('https://substack-post-media.s3.amazonaws.com/public/images/x.jpeg'),
    'https://substackcdn.com/image/fetch/w_96,h_96,c_fill,f_png/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fx.jpeg');
  assert.equal(iconSourceUrl('https://wanjiru.example/favicon.png'), 'https://wanjiru.example/favicon.png');
});

test('build downloads icons into /icons and survives failed downloads', async () => {
  const out = mkdtempSync(join(tmpdir(), 'kems-'));
  const d = data();
  d.pieces[0].icon = 'https://cdn.example/good.png';
  d.pieces[1].icon = 'https://cdn.example/broken.png';
  d.writers[0].icon = 'https://cdn.example/writer.png';
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const iconFetch = async (url) => (url.includes('broken') ? new Response('', { status: 404 }) : new Response(png, { headers: { 'content-type': 'image/png' } }));
  await build({ data: d, outDir: out, config: cfg, now: NOW, iconFetch });
  const index = readFileSync(join(out, 'index.html'), 'utf8');
  const srcs = [...index.matchAll(/<img class="avatar" src="\/kems-list\/(icons\/[0-9a-f]+\.png)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 2, index);
  for (const s of srcs) assert.ok(existsSync(join(out, s)), s);
  assert.match(index, /<span class="avatar" aria-hidden="true">M<\/span>/, 'no icon anywhere → the initial');
  assert.equal(srcs.length, 2, 'good icon + the writer icon standing in for the broken one');
});
