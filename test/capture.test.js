import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { capturePage } from '../lib/capture.js';

const page = (html) => parseHTML(html).document;

test('reads a real Substack post: exact title, publish date, author, source, avatar', () => {
  const doc = page(readFileSync(new URL('./fixtures/substack-post.html', import.meta.url), 'utf8'));
  const m = capturePage(doc, 'https://deesknees1.substack.com/p/ijgb-diaries-how-selfish-are-we-part?utm_source=share');
  assert.equal(m.url, 'https://deesknees1.substack.com/p/ijgb-diaries-how-selfish-are-we-part');
  assert.equal(m.title, 'IJGB diaries: How selfish are we? — Part 1');
  assert.equal(m.publishedAt, '2026-10-11T07:39:15.000Z');
  assert.equal(m.author, 'Dianne_-_');
  assert.equal(m.source, 'Dianne_-_');
  assert.equal(m.excerpt, 'Originally written: Jan 4, 2025');
  assert.match(m.icon, /^https:\/\/substackcdn\.com\/image\/fetch\/.*f2ff28da/, 'generic Substack favicon is skipped for the author avatar');
});

test('prefers a publication logo, then a site icon, over the author image', () => {
  const ld = (extra) => `<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', headline: 'H', author: [{ name: 'A', image: { contentUrl: 'https://cdn.example/avatar.jpg' } }], ...extra })}</script>`;
  const withLogo = page(`<html><head>${ld({ publisher: { name: 'Pub', logo: { url: 'https://cdn.example/logo.png' } } })}</head></html>`);
  assert.equal(capturePage(withLogo, 'https://x.example/a').icon, 'https://cdn.example/logo.png');
  const withTouch = page(`<html><head>${ld({ publisher: { name: 'Pub' } })}<link rel="apple-touch-icon" href="/touch.png"></head></html>`);
  assert.equal(capturePage(withTouch, 'https://x.example/a').icon, 'https://x.example/touch.png');
});

test('falls back to Open Graph and plain meta tags on ordinary sites', () => {
  const doc = page(`<html><head><title>Fallback</title>
    <meta property="og:title" content="The Long Walk">
    <meta property="og:site_name" content="Wanjiru Writes">
    <meta property="og:description" content="An essay on distance.">
    <meta property="article:published_time" content="2026-09-30T10:00:00Z">
    <meta name="author" content="Wanjiru K.">
    <link rel="canonical" href="https://wanjiru.example/long-walk">
    <link rel="icon" href="https://wanjiru.example/favicon.png"></head></html>`);
  assert.deepEqual(capturePage(doc, 'https://wanjiru.example/long-walk#comments'), {
    url: 'https://wanjiru.example/long-walk', title: 'The Long Walk', excerpt: 'An essay on distance.',
    publishedAt: '2026-09-30T10:00:00.000Z', author: 'Wanjiru K.', source: 'Wanjiru Writes', icon: 'https://wanjiru.example/favicon.png',
  });
});

test('missing fields are omitted, never invented', () => {
  const m = capturePage(page('<html><head></head><body>hi</body></html>'), 'https://bare.example/p/x');
  assert.deepEqual(m, { url: 'https://bare.example/p/x', source: 'bare.example' });
});

test('broken JSON-LD is ignored', () => {
  const doc = page('<html><head><script type="application/ld+json">{not json</script><meta property="og:title" content="OK"></head></html>');
  assert.equal(capturePage(doc, 'https://x.example/a').title, 'OK');
});

test('works when serialised and re-created, as the bookmarklet does', () => {
  const recreated = new Function(`return (${capturePage.toString()})`)();
  const doc = page(readFileSync(new URL('./fixtures/substack-post.html', import.meta.url), 'utf8'));
  assert.deepEqual(recreated(doc, 'https://deesknees1.substack.com/p/ijgb-diaries-how-selfish-are-we-part'), capturePage(doc, 'https://deesknees1.substack.com/p/ijgb-diaries-how-selfish-are-we-part'));
});

test('still works flattened to one line with comments removed (as the bookmarklet ships)', () => {
  const flat = capturePage.toString().replace(/^\s*\/\/.*$/gm, '').replace(/\s*\n\s*/g, ' ');
  assert.ok(!flat.includes('\n'));
  const recreated = new Function(`return (${flat})`)();
  const doc = page(readFileSync(new URL('./fixtures/substack-post.html', import.meta.url), 'utf8'));
  assert.equal(recreated(doc, 'https://deesknees1.substack.com/p/x').title, 'IJGB diaries: How selfish are we? — Part 1');
});

test('trims whitespace around captured text', () => {
  const doc = page(`<html><head><script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', headline: 'Is the Nigerian Stock Market in a bubble? ', description: '  A data-driven assessment. ', author: [{ name: ' Dalu ' }] })}</script></head></html>`);
  const m = capturePage(doc, 'https://igwe007.substack.com/p/x');
  assert.equal(m.title, 'Is the Nigerian Stock Market in a bubble?');
  assert.equal(m.excerpt, 'A data-driven assessment.');
  assert.equal(m.author, 'Dalu');
});

test('defaults to the current page, so a browser extension can run it with no arguments', () => {
  const doc = page(readFileSync(new URL('./fixtures/substack-post.html', import.meta.url), 'utf8'));
  const run = new Function('document', 'location', `return (${capturePage.toString()})();`);
  const m = run(doc, { href: 'https://deesknees1.substack.com/p/ijgb-diaries-how-selfish-are-we-part' });
  assert.equal(m.title, 'IJGB diaries: How selfish are we? — Part 1');
});
