import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../scripts/discover.js';
import { idFor } from '../scripts/lib/canonical.js';

const NOW = new Date('2026-10-15T12:00:00Z');
const words = (n) => `<p>${'Lagos at dawn is a different city entirely. '.repeat(Math.ceil(n / 8))}</p>`;

function rss(items) {
  return `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Ada</title>
  ${items.map((i) => `<item><title>${i.title}</title><link>${i.url}</link><pubDate>${new Date(i.date).toUTCString()}</pubDate>
  <description>${i.desc ?? 'A long enough description of this essay for the excerpt to use it directly.'}</description>
  <content:encoded><![CDATA[${words(i.words ?? 600)}]]></content:encoded></item>`).join('')}</channel></rss>`;
}

function fakeFetch(routes) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (r === undefined) return new Response('nope', { status: 404 });
    if (r instanceof Error) throw r;
    if (typeof r === 'number') return new Response('', { status: r });
    return new Response(r, { status: 200, headers: { 'content-type': 'application/xml' } });
  };
  return { impl, calls };
}

const writer = (id, links, extra = {}) => ({ id, name: id, links, active: true, addedAt: '2026-10-01T00:00:00Z', ...extra });
const empty = () => ({ writers: [], inbox: [], pieces: [], skipped: [], queue: [], status: { feeds: {}, deadLinks: [], linkChecks: {} } });
const post = (n, day) => ({ title: `Post ${n}`, url: `https://medium.com/@ada/post-${n}`, date: `2026-10-${String(day).padStart(2, '0')}T09:00:00Z` });

test('a new writer is seeded with their 3 most recent pieces only', async () => {
  const data = { ...empty(), writers: [writer('ada', { medium: 'https://medium.com/@ada' })] };
  const { impl } = fakeFetch({ 'https://medium.com/feed/@ada': rss([post(1, 1), post(5, 5), post(3, 3), post(4, 4), post(2, 2)]) });
  const { queue, status } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.deepEqual(queue.map((q) => q.title), ['Post 5', 'Post 4', 'Post 3']);
  assert.equal(queue[0].writerId, 'ada');
  const s = status.feeds['ada:medium'];
  assert.equal(s.feedUrl, 'https://medium.com/feed/@ada');
  assert.equal(s.lastOk, NOW.toISOString());
  assert.equal(s.failCount, 0);
});

test('after seeding, every unknown item is queued; known ones never are', async () => {
  const posts = [post(1, 1), post(2, 2), post(3, 3), post(4, 4), post(5, 5)];
  const data = {
    ...empty(),
    writers: [writer('ada', { medium: 'https://medium.com/@ada' })],
    pieces: [{ id: idFor(posts[0].url) }],
    skipped: [idFor(posts[1].url)],
    queue: [{ id: idFor(posts[2].url), title: 'Post 3', publishedAt: '2026-10-03T09:00:00.000Z' }],
    status: { feeds: { 'ada:medium': { feedUrl: 'https://medium.com/feed/@ada', lastOk: '2026-10-14T00:00:00Z', failCount: 0 } }, deadLinks: [], linkChecks: {} },
  };
  const { impl } = fakeFetch({ 'https://medium.com/feed/@ada': rss(posts) });
  const { queue } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.deepEqual(queue.map((q) => q.title), ['Post 5', 'Post 4', 'Post 3']);
});

test('decided ids are pruned from the queue', async () => {
  const data = { ...empty(), queue: [{ id: 'aaaaaaaaaaaa', title: 'A', publishedAt: '2026-10-01T00:00:00Z' }, { id: 'bbbbbbbbbbbb', title: 'B', publishedAt: '2026-10-02T00:00:00Z' }], pieces: [{ id: 'aaaaaaaaaaaa' }] };
  const { queue } = await discover({ data, fetchImpl: fakeFetch({}).impl, now: NOW });
  assert.deepEqual(queue.map((q) => q.id), ['bbbbbbbbbbbb']);
});

test('one broken feed is recorded and the others still run', async () => {
  const data = { ...empty(), writers: [writer('bad', { medium: 'https://medium.com/@bad' }), writer('ada', { medium: 'https://medium.com/@ada' })] };
  data.status.feeds['bad:medium'] = { feedUrl: 'https://medium.com/feed/@bad', lastOk: '2026-10-01T00:00:00Z', failCount: 2 };
  const { impl } = fakeFetch({ 'https://medium.com/feed/@bad': '<html>gone</html>', 'https://medium.com/feed/@ada': rss([post(1, 1)]) });
  const { queue, status } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.equal(queue.length, 1);
  assert.equal(status.feeds['bad:medium'].failCount, 3);
  assert.match(status.feeds['bad:medium'].lastError, /not an RSS or Atom feed/);
  assert.equal(status.feeds['bad:medium'].lastOk, '2026-10-01T00:00:00Z');
});

test('network errors and missing feeds are isolated too', async () => {
  const data = { ...empty(), writers: [writer('net', { medium: 'https://medium.com/@net' }), writer('blog', { site: 'https://blog.example' })] };
  const { impl } = fakeFetch({ 'https://medium.com/feed/@net': new Error('ECONNRESET'), 'https://blog.example': '<html><head></head></html>' });
  const { status } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.match(status.feeds['net:medium'].lastError, /ECONNRESET/);
  assert.match(status.feeds['blog:site'].lastError, /no feed found/);
});

test('paused writers are not fetched', async () => {
  const data = { ...empty(), writers: [writer('ada', { medium: 'https://medium.com/@ada' }, { active: false })] };
  const { impl, calls } = fakeFetch({});
  await discover({ data, fetchImpl: impl, now: NOW });
  assert.deepEqual(calls, []);
});

test('pasted links are enriched from page metadata and matched to a writer by host', async () => {
  const data = {
    ...empty(),
    writers: [writer('wanjiru', { site: 'https://wanjiru.example' })],
    inbox: [{ url: 'https://wanjiru.example/essays/long-walk?utm_source=x', addedAt: '2026-10-14T00:00:00Z' }, { url: 'https://down.example/x', addedAt: '2026-10-14T00:00:00Z' }],
  };
  data.status.feeds['wanjiru:site'] = { feedUrl: 'https://wanjiru.example/feed', lastOk: '2026-10-14T00:00:00Z', failCount: 0 };
  const page = `<html><head><meta property="og:title" content="The Long Walk"><meta property="og:description" content="An essay on distance, and on the people who walk it every day."><meta property="article:published_time" content="2026-09-30T10:00:00Z"></head></html>`;
  const { impl } = fakeFetch({ 'https://wanjiru.example/feed': rss([]), 'https://wanjiru.example/essays/long-walk': page });
  const { queue } = await discover({ data, fetchImpl: impl, now: NOW });
  const walk = queue.find((q) => q.url === 'https://wanjiru.example/essays/long-walk');
  assert.equal(walk.title, 'The Long Walk');
  assert.equal(walk.writerId, 'wanjiru');
  assert.equal(walk.publishedAt, '2026-09-30T10:00:00.000Z');
  assert.equal(walk.id, idFor('https://wanjiru.example/essays/long-walk'));
  const down = queue.find((q) => q.url === 'https://down.example/x');
  assert.equal(down.title, 'down.example/x', 'unreachable pages still reach the queue for the curator');
});

test('inbox links already decided are not re-queued', async () => {
  const url = 'https://mag.example/a';
  const data = { ...empty(), inbox: [{ url, addedAt: '2026-10-14T00:00:00Z' }], skipped: [idFor(url)] };
  const { impl, calls } = fakeFetch({});
  const { queue } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.equal(queue.length, 0);
  assert.deepEqual(calls, []);
});

test('weekly check flags a published link after two consecutive 404s, and clears it on recovery', async () => {
  const a = 'https://ada.substack.com/p/gone';
  const b = 'https://ada.substack.com/p/fine';
  const data = { ...empty(), pieces: [{ id: idFor(a), url: a }, { id: idFor(b), url: b }] };
  const { impl } = fakeFetch({ [a]: 404, [b]: '<html></html>' });
  let { status } = await discover({ data, fetchImpl: impl, now: NOW, weekly: true });
  assert.deepEqual(status.deadLinks, []);
  ({ status } = await discover({ data: { ...data, status }, fetchImpl: impl, now: NOW, weekly: true }));
  assert.deepEqual(status.deadLinks, [idFor(a)]);
  const recovered = fakeFetch({ [a]: '<html></html>', [b]: '<html></html>' });
  ({ status } = await discover({ data: { ...data, status }, fetchImpl: recovered.impl, now: NOW, weekly: true }));
  assert.deepEqual(status.deadLinks, []);
});

test('queue is sorted newest first', async () => {
  const data = { ...empty(), writers: [writer('ada', { medium: 'https://medium.com/@ada' })] };
  const { impl } = fakeFetch({ 'https://medium.com/feed/@ada': rss([post(2, 2), post(9, 9), post(4, 4)]) });
  const { queue } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.deepEqual(queue.map((q) => q.title), ['Post 9', 'Post 4', 'Post 2']);
});

test('Substack writers are manual: never fetched, marked manual, not failing', async () => {
  const data = { ...empty(), writers: [writer('khaya', { substack: 'https://khayadlanga.substack.com' }), writer('blog', { site: 'https://blog.example' })] };
  data.status.feeds['khaya:substack'] = { feedUrl: 'https://khayadlanga.substack.com/feed', failCount: 4, lastError: 'HTTP 403' };
  const { impl, calls } = fakeFetch({ 'https://blog.example': '<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head></html>', 'https://blog.example/feed': rss([]) });
  const { status } = await discover({ data, fetchImpl: impl, now: NOW });
  assert.ok(calls.every((u) => !u.includes('substack')), calls.join(','));
  assert.deepEqual(status.feeds['khaya:substack'], { manual: true, failCount: 0, reason: 'Substack blocks automatic checks — add their pieces with Add link' });
  assert.equal(status.feeds['blog:site'].failCount, 0);
});

test('pasted links: your title and excerpt win; blocked pages fall back to a title from the URL', async () => {
  const data = {
    ...empty(),
    writers: [writer('khaya', { substack: 'https://khayadlanga.substack.com' })],
    inbox: [
      { url: 'https://khayadlanga.substack.com/p/dear-south-african-education', addedAt: '2026-10-14T00:00:00Z' },
      { url: 'https://khayadlanga.substack.com/p/second-letter', addedAt: '2026-10-14T00:00:00Z', title: 'My Own Title', excerpt: 'My chosen line.' },
    ],
  };
  const { impl } = fakeFetch({ 'https://khayadlanga.substack.com/p/dear-south-african-education': 403, 'https://khayadlanga.substack.com/p/second-letter': 403 });
  const { queue } = await discover({ data, fetchImpl: impl, now: NOW });
  const first = queue.find((q) => q.url.endsWith('dear-south-african-education'));
  assert.equal(first.title, 'Dear South African Education');
  assert.equal(first.writerId, 'khaya');
  assert.equal(first.platform, 'Substack');
  const second = queue.find((q) => q.url.endsWith('second-letter'));
  assert.equal(second.title, 'My Own Title');
  assert.equal(second.excerpt, 'My chosen line.');
});

test('pasted links keep every captured detail (date, author, source, icon) over guesses', async () => {
  const data = { ...empty(), inbox: [{ url: 'https://deesknees1.substack.com/p/ijgb-diaries-how-selfish-are-we-part', addedAt: '2026-10-15T20:13:19.876Z', title: 'IJGB diaries: How selfish are we? — Part 1', excerpt: 'Originally written: Jan 4, 2025', publishedAt: '2026-10-11T07:39:15.000Z', author: 'Dianne_-_', source: 'Dianne_-_', icon: 'https://substackcdn.com/image/fetch/a.jpg' }] };
  const { queue } = await discover({ data, fetchImpl: fakeFetch({}).impl, now: NOW });
  assert.equal(queue[0].title, 'IJGB diaries: How selfish are we? — Part 1');
  assert.equal(queue[0].publishedAt, '2026-10-11T07:39:15.000Z');
  assert.equal(queue[0].author, 'Dianne_-_');
  assert.equal(queue[0].source, 'Dianne_-_');
  assert.equal(queue[0].icon, 'https://substackcdn.com/image/fetch/a.jpg');
});

test('fetchable pasted pages get source, author and icon from the page itself', async () => {
  const page = `<html><head><meta property="og:title" content="The Long Walk"><meta property="og:site_name" content="Wanjiru Writes">
    <meta name="author" content="Wanjiru K."><link rel="icon" href="/favicon.png"></head></html>`;
  const data = { ...empty(), inbox: [{ url: 'https://wanjiru.example/long-walk', addedAt: '2026-10-14T00:00:00Z' }] };
  const { queue } = await discover({ data, fetchImpl: fakeFetch({ 'https://wanjiru.example/long-walk': page }).impl, now: NOW });
  assert.equal(queue[0].source, 'Wanjiru Writes');
  assert.equal(queue[0].author, 'Wanjiru K.');
  assert.equal(queue[0].icon, 'https://wanjiru.example/favicon.png');
});

test('feed candidates carry the feed title as source and the feed image as icon', async () => {
  const feedXml = rss([post(1, 1)]).replace('<channel><title>Ada</title>', '<channel><title>Ada Writes</title><image><url>https://cdn.example/ada.png</url></image>');
  const data = { ...empty(), writers: [writer('ada', { medium: 'https://medium.com/@ada' })] };
  const { queue } = await discover({ data, fetchImpl: fakeFetch({ 'https://medium.com/feed/@ada': feedXml }).impl, now: NOW });
  assert.equal(queue[0].source, 'Ada Writes');
  assert.equal(queue[0].icon, 'https://cdn.example/ada.png');
});
