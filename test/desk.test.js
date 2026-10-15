import test from 'node:test';
import assert from 'node:assert/strict';
import { approve, skip, unpublish, editNote, addWriter, setWriterActive, addLink, visibleQueue, slugify, applyLocal } from '../lib/desk.js';

const NOW = '2026-10-15T12:00:00.000Z';
const q = (id, day, extra = {}) => ({ id, url: `https://ada.substack.com/p/${id}`, title: `T ${id}`, writerId: 'ada', publishedAt: `2026-10-${day}T00:00:00.000Z`, excerpt: 'e', platform: 'Substack', paywalled: false, foundAt: NOW, readMinutes: 4, ...extra });
const data = () => ({
  writers: [{ id: 'ada', name: 'Ada', links: { substack: 'https://ada.substack.com' }, active: true, addedAt: NOW }],
  inbox: [], pieces: [], skipped: [],
  queue: [q('aaaaaaaaaaaa', '10'), q('bbbbbbbbbbbb', '12'), q('cccccccccccc', '11')],
  status: { feeds: {}, deadLinks: [], linkChecks: {} },
});

test('visibleQueue hides decided items and sorts newest first', () => {
  const d = data();
  d.skipped = ['cccccccccccc'];
  assert.deepEqual(visibleQueue(d).map((x) => x.id), ['bbbbbbbbbbbb', 'aaaaaaaaaaaa']);
});

test('approve turns a queue item into a piece with note, and undo removes it', () => {
  const d = data();
  const action = approve(d, 'bbbbbbbbbbbb', '  Read this one slowly.  ', NOW);
  assert.deepEqual(action.changes.map((c) => c.file), ['pieces']);
  const after = applyLocal(d, action);
  assert.deepEqual(after.pieces[0], {
    id: 'bbbbbbbbbbbb', url: 'https://ada.substack.com/p/bbbbbbbbbbbb', title: 'T bbbbbbbbbbbb', writerId: 'ada',
    publishedAt: '2026-10-12T00:00:00.000Z', approvedAt: NOW, excerpt: 'e', readMinutes: 4, note: 'Read this one slowly.', platform: 'Substack',
  });
  assert.deepEqual(visibleQueue(after).map((x) => x.id), ['cccccccccccc', 'aaaaaaaaaaaa']);
  const undone = applyLocal(after, action.inverse);
  assert.deepEqual(undone.pieces, []);
  assert.equal(action.message, 'approve: T bbbbbbbbbbbb');
});

test('approve without a note leaves note out; approving twice does not duplicate', () => {
  const d = data();
  const once = applyLocal(d, approve(d, 'aaaaaaaaaaaa', '', NOW));
  assert.equal('note' in once.pieces[0], false);
  const twice = applyLocal(once, approve(d, 'aaaaaaaaaaaa', '', NOW));
  assert.equal(twice.pieces.length, 1);
});

test('approve applied to a newer pieces file keeps the other pieces (conflict re-apply)', () => {
  const d = data();
  const action = approve(d, 'aaaaaaaaaaaa', '', NOW);
  const fresh = [{ id: 'dddddddddddd', title: 'approved elsewhere' }];
  const next = action.changes[0].apply(fresh);
  assert.deepEqual(next.map((p) => p.id), ['aaaaaaaaaaaa', 'dddddddddddd']);
});

test('skip and its undo', () => {
  const d = data();
  const action = skip(d, 'aaaaaaaaaaaa');
  const after = applyLocal(d, action);
  assert.deepEqual(after.skipped, ['aaaaaaaaaaaa']);
  assert.deepEqual(applyLocal(after, action.inverse).skipped, []);
  assert.deepEqual(applyLocal(after, skip(after, 'aaaaaaaaaaaa')).skipped, ['aaaaaaaaaaaa'], 'idempotent');
});

test('unpublish removes the piece and skips it so discovery never re-queues it; undo restores', () => {
  let d = data();
  d = applyLocal(d, approve(d, 'aaaaaaaaaaaa', 'note', NOW));
  const action = unpublish(d, 'aaaaaaaaaaaa');
  assert.deepEqual(action.changes.map((c) => c.file), ['pieces', 'skipped']);
  const after = applyLocal(d, action);
  assert.deepEqual(after.pieces, []);
  assert.deepEqual(after.skipped, ['aaaaaaaaaaaa']);
  const restored = applyLocal(after, action.inverse);
  assert.equal(restored.pieces[0].note, 'note');
  assert.deepEqual(restored.skipped, []);
});

test('editNote sets, trims and clears a note; undo restores the old one', () => {
  let d = data();
  d = applyLocal(d, approve(d, 'aaaaaaaaaaaa', 'old', NOW));
  const action = editNote(d, 'aaaaaaaaaaaa', ' new ');
  const after = applyLocal(d, action);
  assert.equal(after.pieces[0].note, 'new');
  assert.equal('note' in applyLocal(d, editNote(d, 'aaaaaaaaaaaa', '')).pieces[0], false);
  assert.equal(applyLocal(after, action.inverse).pieces[0].note, 'old');
});

test('addWriter slugifies the name, classifies links and avoids id clashes', () => {
  const d = data();
  const action = addWriter(d, { name: 'Ọlá Àdébáyọ̀', country: 'Nigeria', links: ['https://ola.substack.com', 'https://medium.com/@ola', 'https://ola.blog'] }, NOW);
  const after = applyLocal(d, action);
  const w = after.writers.at(-1);
  assert.equal(w.id, 'ola-adebayo');
  assert.deepEqual(w.links, { substack: 'https://ola.substack.com', medium: 'https://medium.com/@ola', site: 'https://ola.blog' });
  assert.equal(w.active, true);
  assert.equal(w.country, 'Nigeria');
  const again = applyLocal(after, addWriter(after, { name: 'Ola Adebayo', links: ['https://other.blog'] }, NOW));
  assert.equal(again.writers.at(-1).id, 'ola-adebayo-2');
  assert.deepEqual(applyLocal(after, action.inverse).writers.map((x) => x.id), ['ada']);
});

test('addWriter rejects missing names and bad links', () => {
  assert.throws(() => addWriter(data(), { name: ' ', links: ['https://x.com'] }, NOW), /name/);
  assert.throws(() => addWriter(data(), { name: 'X', links: ['not a url'] }, NOW), /link/);
  assert.throws(() => addWriter(data(), { name: 'X', links: [] }, NOW), /link/);
});

test('setWriterActive pauses and resumes', () => {
  const d = data();
  const action = setWriterActive(d, 'ada', false);
  const after = applyLocal(d, action);
  assert.equal(after.writers[0].active, false);
  assert.equal(applyLocal(after, action.inverse).writers[0].active, true);
});

test('addLink appends to the inbox, ignores duplicates and drops entries older than 7 days', () => {
  const d = data();
  d.inbox = [{ url: 'https://old.example/a', addedAt: '2026-10-01T00:00:00.000Z' }, { url: 'https://mag.example/b', addedAt: '2026-10-14T00:00:00.000Z' }];
  const after = applyLocal(d, addLink(d, ' https://mag.example/new-essay ', NOW));
  assert.deepEqual(after.inbox.map((i) => i.url), ['https://mag.example/b', 'https://mag.example/new-essay']);
  const dup = applyLocal(after, addLink(after, 'https://mag.example/new-essay', NOW));
  assert.equal(dup.inbox.length, 2);
  assert.throws(() => addLink(d, 'javascript:alert(1)', NOW), /link/);
});

test('slugify', () => {
  assert.equal(slugify('  Chimamanda Ngozi Adichie '), 'chimamanda-ngozi-adichie');
  assert.equal(slugify('N’gũgĩ wa Thiong’o'), 'ngugi-wa-thiongo');
});

test('addLink keeps an optional title and excerpt, trimmed', () => {
  const d = data();
  const after = applyLocal(d, addLink(d, 'https://khayadlanga.substack.com/p/dear-sa', NOW, { title: '  Dear South African Education ', excerpt: ' A letter to a system. ' }));
  assert.deepEqual(after.inbox.at(-1), { url: 'https://khayadlanga.substack.com/p/dear-sa', addedAt: NOW, title: 'Dear South African Education', excerpt: 'A letter to a system.' });
  const bare = applyLocal(d, addLink(d, 'https://x.example/a', NOW, { title: ' ', excerpt: '' }));
  assert.deepEqual(Object.keys(bare.inbox.at(-1)).sort(), ['addedAt', 'url']);
});

test('addLink carries captured details; approve copies them onto the piece', () => {
  const d = data();
  const captured = { title: 'IJGB diaries', excerpt: 'Originally written', publishedAt: '2026-10-11T07:39:15.000Z', author: 'Dianne', source: 'Dee', icon: 'https://substackcdn.com/a.jpg', ignored: 'x' };
  const after = applyLocal(d, addLink(d, 'https://deesknees1.substack.com/p/ijgb', NOW, captured));
  const { ignored, ...expected } = captured;
  assert.deepEqual(after.inbox.at(-1), { url: 'https://deesknees1.substack.com/p/ijgb', addedAt: NOW, ...expected });
  const withQueue = { ...d, queue: [{ ...q('dddddddddddd', '11'), writerId: undefined, source: 'Dee', author: 'Dianne', icon: 'https://substackcdn.com/a.jpg' }] };
  const piece = applyLocal(withQueue, approve(withQueue, 'dddddddddddd', '', NOW)).pieces[0];
  assert.equal(piece.source, 'Dee');
  assert.equal(piece.author, 'Dianne');
  assert.equal(piece.icon, 'https://substackcdn.com/a.jpg');
});
