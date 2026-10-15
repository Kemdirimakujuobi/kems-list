import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  feedUrlFor, discoverFeedUrl, parseFeed, toCandidate, excerptOf, readMinutes, textOf, pageMeta, platformOf,
} from '../scripts/lib/feeds.js';

const fixture = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-15T12:00:00Z');
const html = (s, type = 'text/html') => async () => new Response(s, { status: 200, headers: { 'content-type': type } });

test('feedUrlFor knows Substack and Medium URL shapes', () => {
  assert.equal(feedUrlFor('https://ada.substack.com'), 'https://ada.substack.com/feed');
  assert.equal(feedUrlFor('https://ada.substack.com/p/some-post'), 'https://ada.substack.com/feed');
  assert.equal(feedUrlFor('https://substack.com/@ada'), 'https://ada.substack.com/feed');
  assert.equal(feedUrlFor('https://medium.com/@kem'), 'https://medium.com/feed/@kem');
  assert.equal(feedUrlFor('https://medium.com/@kem/some-post-123'), 'https://medium.com/feed/@kem');
  assert.equal(feedUrlFor('https://kem.medium.com/'), 'https://medium.com/feed/@kem');
  assert.equal(feedUrlFor('https://medium.com/lolwe'), 'https://medium.com/feed/lolwe');
  assert.equal(feedUrlFor('https://www.noahpinion.blog'), null);
});

test('discoverFeedUrl reads <link rel=alternate> from the page, resolving relative hrefs', async () => {
  const page = '<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed"></head></html>';
  assert.equal(await discoverFeedUrl('https://www.noahpinion.blog/', html(page)), 'https://www.noahpinion.blog/feed');
  assert.equal(await discoverFeedUrl('https://ada.substack.com', html('')), 'https://ada.substack.com/feed');
  assert.equal(await discoverFeedUrl('https://nofeed.example', html('<html></html>')), null);
});

test('parseFeed reads a real Substack feed', () => {
  const feed = parseFeed(fixture('substack.xml'));
  assert.equal(feed.generator.includes('Substack') || feed.isSubstack, true);
  assert.equal(feed.items.length, 3);
  const [first] = feed.items;
  assert.equal(first.title, 'AI vs. the railroads');
  assert.match(first.url, /^https:\/\/www\.noahpinion\.blog\/p\//);
  assert.equal(first.publishedAt, '2026-10-15T08:47:39.000Z');
  assert.equal(first.description, 'Are we in 1872?');
  assert.ok(first.html.length > 1000);
});

test('parseFeed reads a real Medium feed', () => {
  const feed = parseFeed(fixture('medium.xml'));
  assert.equal(feed.items.length, 3);
  assert.equal(feed.items[0].title, 'Making “Social” Social Again');
  assert.match(feed.items[0].url, /^https:\/\/ev\.medium\.com\/making-social/);
});

test('parseFeed reads Atom with HTML titles, enclosures and missing dates', () => {
  const { items } = parseFeed(fixture('blog-atom.xml'));
  assert.equal(items.length, 4);
  assert.equal(items[0].title, 'Lagos & the <sea> — “a love letter”');
  assert.equal(items[0].url, 'https://ama.example.com/2026/10/lagos-sea/?utm_source=rss');
  assert.equal(items[0].publishedAt, '2026-10-12T08:30:00.000Z');
  assert.equal(items[1].enclosureType, 'audio/mpeg');
  assert.equal(items[3].publishedAt, null);
});

test('parseFeed throws on non-feed content', () => {
  assert.throws(() => parseFeed('<html><body>Not Found</body></html>'), /not an RSS or Atom feed/);
});

test('textOf strips tags and decodes entities', () => {
  assert.equal(textOf('<p>Hello&nbsp;<b>world</b> &amp; &#8220;friends&#8221; &rsquo;s &#x2014;</p><script>x()</script>'), 'Hello world & “friends” ’s —');
});

test('excerptOf cuts at a sentence, else a word, within 280 chars', () => {
  const sentences = 'The water keeps its own time. '.repeat(15);
  const e = excerptOf(sentences);
  assert.ok(e.length <= 280);
  assert.ok(e.endsWith('time.'));
  const words = 'longword '.repeat(60);
  const w = excerptOf(words);
  assert.ok(w.length <= 280 && w.endsWith('…') && !w.includes('longwor…'));
  assert.equal(excerptOf('Short.'), 'Short.');
});

test('readMinutes is words/230, min 1', () => {
  assert.equal(readMinutes(`<p>${'w '.repeat(2300)}</p>`), 10);
  assert.equal(readMinutes('<p>hi</p>'), 1);
});

test('platformOf names Substack, Medium, or the host', () => {
  assert.equal(platformOf('https://ada.substack.com/p/x'), 'Substack');
  assert.equal(platformOf('https://www.noahpinion.blog/p/x', { isSubstack: true }), 'Substack');
  assert.equal(platformOf('https://ev.medium.com/x'), 'Medium');
  assert.equal(platformOf('https://www.ama.example.com/x'), 'ama.example.com');
});

test('toCandidate builds queue items and applies the noise filters', () => {
  const feed = parseFeed(fixture('blog-atom.xml'));
  const [essay, podcast, note, undated] = feed.items.map((i) => toCandidate(i, { writerId: 'ama', now: NOW, feed }));
  assert.deepEqual(Object.keys(essay).sort(), ['excerpt', 'foundAt', 'id', 'paywalled', 'platform', 'publishedAt', 'readMinutes', 'title', 'url', 'writerId'].sort());
  assert.equal(essay.url, 'https://ama.example.com/2026/10/lagos-sea');
  assert.match(essay.id, /^[0-9a-f]{12}$/);
  assert.equal(essay.platform, 'ama.example.com');
  assert.equal(essay.readMinutes, 2);
  assert.ok(essay.excerpt.startsWith('The water keeps its own time.'));
  assert.equal(essay.paywalled, false);
  assert.equal(essay.foundAt, NOW.toISOString());
  assert.equal(podcast, null, 'audio enclosures are dropped');
  assert.equal(note, null, 'short posts are dropped');
  assert.equal(undated.publishedAt, NOW.toISOString(), 'missing dates fall back to now');
  assert.equal(undated.readMinutes, undefined);
});

test('excerpts come from body paragraphs, not captions or headings', () => {
  const body = `<figure><img src="a.jpg"><figcaption><p>Image via The Nobel Prize</p></figcaption></figure>
    <h2>Announcing Mozi</h2><p>Ev Williams</p>
    <p>Last week, Brazil’s Congress shocked the world by suddenly passing a bill about the rainforest.</p>
    <p>${'More words follow here. '.repeat(70)}</p>`;
  const c = toCandidate({ url: 'https://x.example/p', title: 'T', publishedAt: null, description: 'short', html: body }, { now: NOW });
  assert.ok(c.excerpt.startsWith('Last week, Brazil’s Congress'), c.excerpt);
});

test('toCandidate keeps truncated paywalled posts and flags them', () => {
  const feed = { isSubstack: true, items: [] };
  const item = { url: 'https://ada.substack.com/p/paid', title: 'Paid', publishedAt: '2026-10-10T00:00:00.000Z', description: 'A members-only essay about Accra.', html: '<p>Intro.</p><div class="paywall-jump"></div><p>This post is for paid subscribers</p>' };
  const c = toCandidate(item, { writerId: 'ada', now: NOW, feed });
  assert.equal(c.paywalled, true);
  assert.equal(c.readMinutes, undefined);
  const medium = { ...item, url: 'https://medium.com/@k/x', html: '<p>Start</p><p>Continue reading on Medium »</p>' };
  assert.equal(toCandidate(medium, { writerId: 'k', now: NOW, feed: {} }).paywalled, true);
});

test('pageMeta reads Open Graph and article metadata', () => {
  const meta = pageMeta(`<html><head><title>Fallback</title>
    <meta property="og:title" content="The Long Walk &amp; After">
    <meta property="og:description" content="An essay on distance.">
    <meta property="article:published_time" content="2026-09-30T10:00:00Z">
    <meta name="author" content="Wanjiru K.">
    <link rel="canonical" href="https://mag.example/essays/long-walk"></head></html>`);
  assert.deepEqual(meta, { title: 'The Long Walk & After', description: 'An essay on distance.', publishedAt: '2026-09-30T10:00:00.000Z', author: 'Wanjiru K.', canonical: 'https://mag.example/essays/long-walk' });
});
