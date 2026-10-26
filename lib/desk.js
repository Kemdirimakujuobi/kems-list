// Desk actions as pure data. Each action = { message, changes: [{ file, apply(current) → next }], inverse }.
// `apply` receives the *current* contents of the file, so an action can be re-applied to fresher data
// after a save conflict without losing anyone's work. Shared by the browser desk and Node tests.

const DAY = 24 * 3600 * 1000;
const INBOX_KEEP_DAYS = 7;

const change = (file, apply) => ({ file, apply });
const without = (id) => (cur) => cur.filter((x) => (typeof x === 'string' ? x : x.id) !== id);
const withId = (list, id) => list.find((x) => x.id === id);
const byApprovedDesc = (a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt);

export function applyLocal(data, action) {
  const next = { ...data };
  for (const c of action.changes) next[c.file] = c.apply(next[c.file]);
  return next;
}

export function visibleQueue(data) {
  const decided = new Set([...data.pieces.map((p) => p.id), ...data.skipped]);
  return data.queue.filter((q) => !decided.has(q.id)).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
}

const clean = (note) => (typeof note === 'string' ? note.trim() : '');

export function approve(data, id, note, now = new Date().toISOString()) {
  const item = withId(data.queue, id);
  if (!item) throw new Error('That piece is no longer in the queue.');
  const piece = {
    id: item.id, url: item.url, title: item.title,
    ...(item.writerId ? { writerId: item.writerId } : {}),
    publishedAt: item.publishedAt, approvedAt: now,
    ...(item.excerpt ? { excerpt: item.excerpt } : {}),
    ...(item.readMinutes ? { readMinutes: item.readMinutes } : {}),
    ...(clean(note) ? { note: clean(note) } : {}),
    platform: item.platform,
    ...(item.source ? { source: item.source } : {}),
    ...(item.author ? { author: item.author } : {}),
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.lang ? { lang: item.lang } : {}),
  };
  return {
    message: `approve: ${item.title}`,
    changes: [change('pieces', (cur) => (cur.some((p) => p.id === id) ? cur : [piece, ...cur]))],
    inverse: { message: `undo approve: ${item.title}`, changes: [change('pieces', without(id))] },
  };
}

export function skip(data, id) {
  const title = withId(data.queue, id)?.title ?? id;
  return {
    message: `skip: ${title}`,
    changes: [change('skipped', (cur) => (cur.includes(id) ? cur : [...cur, id]))],
    inverse: { message: `undo skip: ${title}`, changes: [change('skipped', without(id))] },
  };
}

export function unpublish(data, id) {
  const piece = withId(data.pieces, id);
  if (!piece) throw new Error('That piece is not published.');
  return {
    message: `unpublish: ${piece.title}`,
    changes: [change('pieces', without(id)), change('skipped', (cur) => (cur.includes(id) ? cur : [...cur, id]))],
    inverse: {
      message: `undo unpublish: ${piece.title}`,
      changes: [
        change('pieces', (cur) => (cur.some((p) => p.id === id) ? cur : [...cur, piece].sort(byApprovedDesc))),
        change('skipped', without(id)),
      ],
    },
  };
}

function setNote(id, note) {
  return (cur) => cur.map((p) => {
    if (p.id !== id) return p;
    const { note: _old, ...rest } = p;
    return clean(note) ? { ...rest, note: clean(note) } : rest;
  });
}

export function editNote(data, id, note) {
  const piece = withId(data.pieces, id);
  if (!piece) throw new Error('That piece is not published.');
  return {
    message: `note: ${piece.title}`,
    changes: [change('pieces', setNote(id, note))],
    inverse: { message: `undo note: ${piece.title}`, changes: [change('pieces', setNote(id, piece.note ?? ''))] },
  };
}

export function slugify(name) {
  return String(name).normalize('NFD').replace(/\p{M}/gu, '').replace(/['’‘`]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function httpUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href.replace(/\/$/, '') : null;
  } catch { return null; }
}

function linkKind(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (host === 'substack.com' || host.endsWith('.substack.com')) return 'substack';
  if (host === 'medium.com' || host.endsWith('.medium.com')) return 'medium';
  return 'site';
}

export function addWriter(data, { name, country, links }, now = new Date().toISOString()) {
  if (!clean(name)) throw new Error('A writer needs a name.');
  const urls = (links ?? []).map((l) => String(l).trim()).filter(Boolean);
  if (urls.length === 0) throw new Error('Add at least one link (Substack, Medium or site).');
  const keyed = {};
  for (const raw of urls) {
    const url = httpUrl(raw);
    if (!url) throw new Error(`That link doesn't look right: ${raw}`);
    const kind = linkKind(url);
    let key = kind;
    for (let n = 2; key in keyed; n++) key = `${kind}${n}`;
    keyed[key] = url;
  }
  const base = slugify(name) || 'writer';
  let id = base;
  for (let n = 2; data.writers.some((w) => w.id === id); n++) id = `${base}-${n}`;
  const writer = { id, name: clean(name), ...(clean(country) ? { country: clean(country) } : {}), links: keyed, active: true, addedAt: now };
  return {
    message: `add writer: ${writer.name}`,
    changes: [change('writers', (cur) => (cur.some((w) => w.id === id) ? cur : [...cur, writer]))],
    inverse: { message: `undo add writer: ${writer.name}`, changes: [change('writers', without(id))] },
  };
}

export function setWriterActive(data, id, active) {
  const writer = withId(data.writers, id);
  if (!writer) throw new Error('Unknown writer.');
  const set = (value) => (cur) => cur.map((w) => (w.id === id ? { ...w, active: value } : w));
  return {
    message: `${active ? 'resume' : 'pause'} writer: ${writer.name}`,
    changes: [change('writers', set(active))],
    inverse: { message: `undo ${active ? 'resume' : 'pause'}: ${writer.name}`, changes: [change('writers', set(writer.active))] },
  };
}

// Details captured in the curator's browser (bookmarklet) or typed in the dialog. They win over anything
// discovery can fetch, since Substack pages can't be read from GitHub's servers.
// Substack's own share/app links → the post's real address; app links that only carry a numeric id can't be
// resolved without reading Substack, which GitHub's servers can't do.
function substackPostUrl(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, '');
  const open = host === 'open.substack.com' && u.pathname.match(/^\/pub\/([\w-]+)\/p\/([\w-]+)/);
  if (open) return `https://${open[1]}.substack.com/p/${open[2]}`;
  if (host === 'substack.com' && /^\/(home\/post\/|@[\w.-]+\/(p-|note\/))/.test(u.pathname)) {
    throw new Error('That\'s a Substack app link, which doesn\'t say which post it is. Open the post in your browser and use the + Kem\'s List bookmark (or paste its own address, like name.substack.com/p/…).');
  }
  return url;
}

export function addLink(data, raw, now = new Date().toISOString(), details = {}) {
  let url = httpUrl(raw);
  if (!url) throw new Error("That link doesn't look right.");
  url = substackPostUrl(url);
  const cutoff = Date.parse(now) - INBOX_KEEP_DAYS * DAY;
  const entry = { url, addedAt: now };
  for (const key of ['title', 'excerpt', 'author', 'source']) if (clean(details[key])) entry[key] = clean(details[key]);
  const published = Date.parse(details.publishedAt);
  if (!Number.isNaN(published)) entry.publishedAt = new Date(published).toISOString();
  if (httpUrl(details.icon)) entry.icon = details.icon.trim();
  if (/^https?:\/\/([\w-]+\.)?substack\.com\//.test(url)) {
    if (!entry.title) throw new Error('Substack pages can\'t be read by the server. Use the + Kem\'s List bookmark on the post, or type its title and publish date.');
    if (!entry.publishedAt) throw new Error('Add the publish date too. Substack pages can\'t be read by the server, so it can\'t find it.');
  }
  return {
    message: `add link: ${entry.title ?? url}`,
    changes: [change('inbox', (cur) => {
      const kept = cur.filter((e) => Date.parse(e.addedAt) >= cutoff);
      return kept.some((e) => e.url === url) ? kept : [...kept, entry];
    })],
    inverse: { message: `undo add link: ${url}`, changes: [change('inbox', (cur) => cur.filter((e) => e.url !== url))] },
  };
}
