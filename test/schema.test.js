import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../lib/schema.js';

const valid = () => ({
  writers: [{ id: 'ada-okafor', name: 'Ada Okafor', country: 'Nigeria', links: { substack: 'https://ada.substack.com' }, active: true, addedAt: '2026-10-01T00:00:00Z' }],
  inbox: [{ url: 'https://mag.example/essay', addedAt: '2026-10-02T00:00:00Z' }],
  pieces: [{ id: 'aaaaaaaaaaaa', url: 'https://ada.substack.com/p/one', title: 'One', writerId: 'ada-okafor', publishedAt: '2026-10-01T00:00:00Z', approvedAt: '2026-10-02T00:00:00Z', excerpt: 'x', platform: 'Substack' }],
  skipped: ['bbbbbbbbbbbb'],
  queue: [{ id: 'cccccccccccc', url: 'https://ada.substack.com/p/two', title: 'Two', writerId: 'ada-okafor', publishedAt: '2026-10-03T00:00:00Z', excerpt: 'y', platform: 'Substack', paywalled: false, foundAt: '2026-10-03T01:00:00Z' }],
  status: { feeds: {}, deadLinks: [], linkChecks: {} },
});

test('accepts valid data', () => {
  assert.deepEqual(validateData(valid()), []);
});

test('accepts empty data files', () => {
  assert.deepEqual(validateData({ writers: [], inbox: [], pieces: [], skipped: [], queue: [], status: { feeds: {}, deadLinks: [], linkChecks: {} } }), []);
});

test('reports missing fields with a path', () => {
  const d = valid();
  delete d.pieces[0].title;
  assert.deepEqual(validateData(d), ['pieces[0].title: required string']);
});

test('rejects non-http URLs, bad dates, bad ids', () => {
  const d = valid();
  d.pieces[0].url = 'javascript:alert(1)';
  d.queue[0].publishedAt = 'yesterday';
  d.skipped = ['nope'];
  const errors = validateData(d);
  assert.ok(errors.includes('pieces[0].url: must be an http(s) URL'));
  assert.ok(errors.includes('queue[0].publishedAt: must be an ISO date'));
  assert.ok(errors.includes('skipped[0]: must be a 12-char hex id'));
});

test('rejects duplicate ids and unknown writers on pieces', () => {
  const d = valid();
  d.pieces.push({ ...d.pieces[0] });
  d.pieces[1].writerId = 'ghost';
  const errors = validateData(d);
  assert.ok(errors.includes('pieces[1].id: duplicate id aaaaaaaaaaaa'));
  assert.ok(errors.includes('pieces[1].writerId: unknown writer ghost'));
});

test('rejects duplicate writer ids', () => {
  const d = valid();
  d.writers.push({ ...d.writers[0] });
  assert.ok(validateData(d).includes('writers[1].id: duplicate id ada-okafor'));
});

test('inbox entries may carry a title and excerpt', () => {
  const d = valid();
  d.inbox[0] = { ...d.inbox[0], title: 'A title', excerpt: 'A line.' };
  assert.deepEqual(validateData(d), []);
  d.inbox[0].title = 42;
  assert.ok(validateData(d).includes('inbox[0].title: must be a non-empty string'));
});

test('optional source, author, icon and publishedAt are validated where they appear', () => {
  const d = valid();
  d.inbox[0] = { ...d.inbox[0], source: 'Pub', author: 'A', icon: 'https://cdn.example/i.png', publishedAt: '2026-10-11T07:39:15.000Z' };
  d.queue[0] = { ...d.queue[0], source: 'Pub', author: 'A', icon: 'https://cdn.example/i.png' };
  d.pieces[0] = { ...d.pieces[0], source: 'Pub', author: 'A', icon: 'https://cdn.example/i.png' };
  d.writers[0] = { ...d.writers[0], icon: 'https://cdn.example/w.png' };
  assert.deepEqual(validateData(d), []);
  d.pieces[0].icon = 'javascript:alert(1)';
  d.inbox[0].publishedAt = 'soon';
  const errors = validateData(d);
  assert.ok(errors.includes('pieces[0].icon: must be an http(s) URL'));
  assert.ok(errors.includes('inbox[0].publishedAt: must be an ISO date'));
});

test('pieces may carry a two-letter lang that overrides the language guess', () => {
  const d = valid();
  d.pieces[0].lang = 'fr';
  assert.deepEqual(validateData(d), []);
  d.pieces[0].lang = 'French';
  assert.deepEqual(validateData(d), ['pieces[0].lang: must be a two-letter language code like fr']);
});
