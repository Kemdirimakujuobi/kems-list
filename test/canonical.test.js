import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, idFor } from '../scripts/lib/canonical.js';

test('canonicalUrl normalises host, tracking params, hash and trailing slash', () => {
  assert.equal(canonicalUrl('https://WWW.Example.COM/Post/?utm_source=x&utm_medium=y&ref=tw#top'), 'https://www.example.com/Post');
  assert.equal(canonicalUrl('https://x.substack.com/p/essay?source=post_page&s=r'), 'https://x.substack.com/p/essay');
  assert.equal(canonicalUrl('https://medium.com/@kem/title-abc123?source=rss----1'), 'https://medium.com/@kem/title-abc123');
  assert.equal(canonicalUrl('https://example.com/?page=2'), 'https://example.com/?page=2');
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com');
});

test('canonicalUrl rejects non-http URLs', () => {
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
  assert.equal(canonicalUrl('not a url'), null);
});

test('idFor is 12 hex chars and equal for equivalent URLs', () => {
  const a = idFor('https://x.substack.com/p/essay');
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(a, idFor('https://X.substack.com/p/essay/?utm_campaign=z'));
  assert.notEqual(a, idFor('https://x.substack.com/p/other'));
});

test('idFor treats http and https as the same piece (Blogspot pages say http, their feeds https)', () => {
  assert.equal(idFor('http://ada.blogspot.com/2026/07/post.html'), idFor('https://ada.blogspot.com/2026/07/post.html'));
});
