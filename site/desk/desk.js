// The desk: private, keyboard-first curation for Kem's List. Static page; talks only to api.github.com.
import { createRepo } from '../lib/github.js';
import { capturePage } from '../lib/capture.js';
import { validateData } from '../lib/schema.js';
import {
  approve, skip, unpublish, editNote, addWriter, setWriterActive, addLink, visibleQueue,
} from '../lib/desk.js';

const FILES = ['writers', 'inbox', 'pieces', 'skipped', 'queue', 'status'];
const store = {
  get: (k) => { try { return localStorage.getItem(`kems.${k}`); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(`kems.${k}`, v); } catch { /* private mode: session only */ } },
  del: (k) => { try { localStorage.removeItem(`kems.${k}`); } catch { /* ignore */ } },
};

function defaultRepo() {
  const host = location.hostname;
  if (host.endsWith('.github.io')) return { owner: host.split('.')[0], repo: location.pathname.split('/').filter(Boolean)[0] || '' };
  return { owner: 'kemdirimakujuobi', repo: 'kems-list' };
}

const state = {
  repo: null, data: null, tab: 'queue', sel: 0, open: false,
  undo: [], busy: false, toast: null, dialog: null, editing: false, prefill: null,
};

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (iso) => { const d = new Date(iso); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const ago = (iso) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};

/* ---------- data access ---------- */

const writerOf = (id) => state.data.writers.find((w) => w.id === id);
const nameOf = (item) => writerOf(item.writerId)?.name ?? item.source ?? item.platform;
function avatarOf(name, icon) {
  return icon ? `<img class="avatar" src="${esc(icon)}" alt="" width="28" height="28" referrerpolicy="no-referrer">` : `<span class="avatar">${esc(String(name)[0]?.toUpperCase() ?? '·')}</span>`;
}

// The "+ Kem's List" bookmarklet: runs capturePage() on the page you're reading, then opens this desk with it.
function bookmarklet() {
  const desk = `${location.origin}${location.pathname}`;
  // One line, no comments: some browsers strip newlines from bookmarks, which would swallow code after a `//`.
  const fn = capturePage.toString().replace(/^\s*\/\/.*$/gm, '').replace(/\s*\n\s*/g, ' ');
  const code = `(()=>{const capturePage=${fn};const m=capturePage(document,location.href);const u=${JSON.stringify(desk)}+'#add='+encodeURIComponent(JSON.stringify(m));if(!window.open(u,'_blank'))location.href=u;})()`;
  return `javascript:${encodeURIComponent(code)}`;
}

function readAddHash() {
  const m = location.hash.match(/^#add=(.+)$/);
  if (!m) return null;
  try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
}

function list() {
  const d = state.data;
  if (state.tab === 'queue') return visibleQueue(d);
  if (state.tab === 'writers') return [...d.writers].sort((a, b) => a.name.localeCompare(b.name));
  return [...d.pieces].sort((a, b) => Date.parse(b.approvedAt) - Date.parse(a.approvedAt));
}
const current = () => list()[state.sel];

function feedHealth(writerId) {
  const entries = Object.entries(state.data.status.feeds || {}).filter(([k]) => k.startsWith(`${writerId}:`)).map(([, v]) => v);
  return entries.find((e) => e.failCount > 0) ?? entries[0] ?? null;
}

/* ---------- rendering ---------- */

function render() {
  if (!state.repo) { renderUnlock(); if (state.toast) app.insertAdjacentHTML('beforeend', `<div class="toast ${state.toast.error ? 'error' : ''}" role="status">${esc(state.toast.text)}</div>`); return; }
  if (!state.data) { app.innerHTML = '<p class="empty">Loading…</p>'; return; }
  const items = list();
  state.sel = Math.max(0, Math.min(state.sel, items.length - 1));
  const counts = { queue: visibleQueue(state.data).length, writers: state.data.writers.length, published: state.data.pieces.length };
  const feeds = Object.values(state.data.status.feeds || {});
  const manual = feeds.filter((f) => f.manual).length;
  const lastCheck = feeds.filter((f) => !f.manual).map((f) => f.lastOk).filter(Boolean).sort().pop();
  const checked = lastCheck ? `Feeds last checked ${ago(lastCheck)}` : feeds.length > manual ? 'Feeds not checked yet — discovery runs every 3 hours' : '';
  const manualNote = manual ? `${manual} Substack writer${manual > 1 ? 's' : ''} curated by hand — add their pieces with Add link (n)` : '';
  const failing = state.data.writers.filter((w) => w.active && (feedHealth(w.id)?.failCount ?? 0) > 0).length;

  app.innerHTML = `
<header class="top desk-top">
  <a class="brand" href="../">Kem's List · Desk</a>
  <nav>
    ${['queue', 'writers', 'published'].map((t) => `<button data-tab="${t}" class="${state.tab === t ? 'on' : ''}">${t[0].toUpperCase()}${t.slice(1)}<span class="count">${counts[t]}</span></button>`).join('')}
    <button data-do="link">Add link<kbd>n</kbd></button>
    <button data-do="writer">Add writer<kbd>w</kbd></button>
    <button data-do="help">Keys<kbd>?</kbd></button>
    <button data-do="lock">Lock</button>
  </nav>
</header>
<main class="desk">
  <p class="status-line">${[checked, manualNote].filter(Boolean).join(' · ') || 'No writers yet'}${failing ? ` · <span class="fail">${failing} writer${failing > 1 ? 's' : ''} with a failing feed</span>` : ''}${state.busy ? ' · Saving…' : ''}</p>
  <div class="panes ${state.open ? 'is-open' : ''}">
    <div class="rows-wrap">${items.length ? `<ol class="rows">${items.map(renderRow).join('')}</ol>` : renderEmpty()}</div>
    <aside class="pane">${items.length ? renderPane(current()) : '<p class="pane-empty">Nothing selected</p>'}</aside>
  </div>
</main>
${state.dialog ? renderDialog() : ''}
${state.toast ? `<div class="toast ${state.toast.error ? 'error' : ''}" role="status">${esc(state.toast.text)}${state.toast.undo ? ' <button data-do="undo">Undo</button>' : ''}</div>` : ''}`;

  app.querySelector('.row.is-active')?.scrollIntoView({ block: 'nearest' });
  if (state.editing) app.querySelector('#note')?.focus();
  if (state.dialog) app.querySelector('.dialog input, .dialog textarea')?.focus();
}

function renderEmpty() {
  const text = { queue: ['Queue is clear', 'New pieces from your writers appear here.'], writers: ['No writers yet', 'Press w to add the first one.'], published: ['Nothing published yet', 'Approve a piece from the queue.'] }[state.tab];
  return `<div class="empty"><p class="empty-title">${text[0]}</p><p>${text[1]}</p></div>`;
}

function renderRow(item, i) {
  const active = i === state.sel ? ' is-active' : '';
  if (state.tab === 'writers') {
    const h = feedHealth(item.id);
    const note = !item.active ? 'paused' : h?.manual ? 'manual' : h?.failCount ? 'feed failing' : h?.lastOk ? 'ok' : 'not checked';
    return `<li><div class="row${active}${item.active ? '' : ' is-dim'}" data-i="${i}" tabindex="-1">${avatarOf(item.name, item.icon)}<span class="subject"><strong>${esc(item.name)}</strong><span class="snippet"> — ${esc([item.country, Object.keys(item.links).join(', ')].filter(Boolean).join(' · '))}</span></span><span class="from"></span><span class="when ${h?.failCount ? 'fail' : ''}">${note}</span></div></li>`;
  }
  const dead = state.tab === 'published' && state.data.status.deadLinks?.includes(item.id);
  return `<li><div class="row${active}" data-i="${i}" tabindex="-1">${avatarOf(nameOf(item), item.icon ?? writerOf(item.writerId)?.icon)}<span class="subject"><strong>${esc(item.title)}</strong>${item.paywalled ? '<span class="badge">paid</span>' : ''}${dead ? '<span class="badge">dead link?</span>' : ''}${item.excerpt ? `<span class="snippet"> — ${esc(item.excerpt)}</span>` : ''}</span><span class="from">${esc(nameOf(item))}</span><span class="when">${short(item.publishedAt)}</span></div></li>`;
}

function renderPane(item) {
  const back = '<button class="back" data-do="close">← Back</button>';
  if (state.tab === 'writers') {
    const h = feedHealth(item.id);
    return `${back}<h2>${esc(item.name)}</h2>
<p class="meta">${esc([item.country, `added ${short(item.addedAt)}`].filter(Boolean).join(' · '))}</p>
<p class="links">${Object.entries(item.links).map(([k, v]) => `${esc(k)}: <a href="${esc(v)}" target="_blank" rel="noopener">${esc(v.replace(/^https?:\/\//, ''))}</a>`).join('<br>')}</p>
${h?.manual ? `<p class="meta">Manual: ${esc(h.reason)}.</p><p class="links"><a href="${esc(Object.values(item.links)[0])}" target="_blank" rel="noopener">Read their latest</a><kbd>o</kbd> then <kbd>n</kbd> to add a piece</p>` : h?.failCount ? `<p class="fail">Feed failing (${h.failCount}×): ${esc(h.lastError)}</p>` : h?.lastOk ? `<p class="meta">Feed ok · checked ${ago(h.lastOk)}</p>` : '<p class="meta">Feed not checked yet</p>'}
<div class="buttons"><button class="button quiet" data-do="toggle-writer">${item.active ? 'Pause' : 'Resume'}<kbd>p</kbd></button></div>`;
  }
  const writer = writerOf(item.writerId);
  const meta = [short(item.publishedAt), item.readMinutes ? `${item.readMinutes} min read` : null, item.platform, item.paywalled ? 'paid subscribers only' : null].filter(Boolean).join(' · ');
  const head = `${back}<h2>${esc(item.title)}</h2>
<p class="byline">${esc(writer ? [writer.name, writer.country].filter(Boolean).join(' · ') : [...new Set([item.author, item.source].filter(Boolean))].join(' · ') || item.platform)}</p>
<p class="meta">${esc(meta)}</p>
${item.excerpt ? `<p class="excerpt">${esc(item.excerpt)}</p>` : ''}
<p class="links"><a href="${esc(item.url)}" target="_blank" rel="noopener">Open original</a><kbd>o</kbd></p>`;
  if (state.tab === 'queue') {
    return `${head}<label class="field"><span>Your note (optional) — Enter saves, Shift+Enter for a new line</span><textarea id="note" placeholder="Why it's worth reading…"></textarea></label>
<div class="buttons"><button class="button" data-do="approve" ${state.busy ? 'disabled' : ''}>Approve<kbd>a</kbd></button><button class="button quiet" data-do="skip" ${state.busy ? 'disabled' : ''}>Skip<kbd>s</kbd></button></div>`;
  }
  return `${head}<label class="field"><span>Your note — Enter saves</span><textarea id="note">${esc(item.note ?? '')}</textarea></label>
<div class="buttons"><button class="button quiet" data-do="save-note" ${state.busy ? 'disabled' : ''}>Save note<kbd>e</kbd></button><button class="button danger" data-do="unpublish" ${state.busy ? 'disabled' : ''}>Unpublish<kbd>x</kbd></button></div>`;
}

function renderDialog() {
  const d = state.dialog;
  if (d === 'help') {
    const keys = [['j / k', 'Move down / up'], ['Enter', 'Open the selected item'], ['o', 'Open the original in a new tab'], ['a', 'Approve — write a note, Enter saves'], ['A', 'Approve without a note'], ['s', 'Skip'], ['u', 'Undo the last action'], ['e', 'Edit note (Published)'], ['x', 'Unpublish (Published)'], ['p', 'Pause / resume writer'], ['n', 'Add a link'], ['w', 'Add a writer'], ['1 2 3', 'Queue · Writers · Published'], ['Esc', 'Close / back']];
    return `<div class="overlay" data-do="dismiss"><div class="dialog"><h2>Add from any page</h2>
<p class="meta">Drag this button to your bookmarks bar. While reading a piece, click it: the desk opens with the exact title, publish date, author, source and logo filled in.</p>
<p><a class="button" href="${esc(bookmarklet())}" onclick="event.preventDefault()">+ Kem's List</a></p>
<h2>Keys</h2><dl class="keys">${keys.map(([k, v]) => `<dt><kbd>${k}</kbd></dt><dd style="margin:0">${v}</dd>`).join('')}</dl></div></div>`;
  }
  if (d === 'link') {
    const f = state.prefill ?? {};
    const captured = [f.author, f.source && f.source !== f.author ? f.source : null].filter(Boolean).join(' · ');
    return `<div class="overlay" data-do="dismiss"><form class="dialog" data-form="link"><h2>${state.prefill ? 'Add this piece' : 'Add a link'}</h2>
${state.prefill ? `<p class="meta" style="display:flex;gap:10px;align-items:center">${f.icon ? avatarOf(captured || '·', f.icon) : ''}<span>${esc(captured || 'Captured from the page')}</span></p>` : ''}
<label class="field"><span>Link</span><input name="url" type="url" required placeholder="https://" value="${esc(f.url ?? '')}"></label>
<label class="field"><span>Title${state.prefill ? '' : ' — needed for Substack links (tip: the + Kem\'s List bookmark fills everything in)'}</span><input name="title" value="${esc(f.title ?? '')}"></label>
<label class="field"><span>Published on${state.prefill ? '' : ' — needed for Substack links'}</span><input name="publishedAt" type="date" value="${esc((f.publishedAt ?? '').slice(0, 10))}"></label>
<label class="field"><span>Excerpt (optional — the subtitle or a line you love)</span><textarea name="excerpt">${esc(f.excerpt ?? '')}</textarea></label>
<input type="hidden" name="author" value="${esc(f.author ?? '')}"><input type="hidden" name="source" value="${esc(f.source ?? '')}"><input type="hidden" name="icon" value="${esc(f.icon ?? '')}">
<div class="buttons"><button class="button" type="submit">Add to queue</button><button class="button quiet" type="button" data-do="dismiss">Cancel</button></div></form></div>`;
  }
  return `<div class="overlay" data-do="dismiss"><form class="dialog" data-form="writer"><h2>Add a writer</h2>
<label class="field"><span>Name</span><input name="name" required></label>
<label class="field"><span>Country (optional)</span><input name="country"></label>
<label class="field"><span>Links — Substack, Medium or site, one per line</span><textarea name="links" required placeholder="https://name.substack.com"></textarea></label>
<div class="buttons"><button class="button" type="submit">Add writer</button><button class="button quiet" type="button" data-do="dismiss">Cancel</button></div></form></div>`;
}

function renderUnlock() {
  const r = defaultRepo();
  app.innerHTML = `<main class="unlock"><h1 class="title">Kem's List · Desk</h1>
<p>The desk saves straight to the GitHub repo. Unlock it once on this device with a fine-grained token:</p>
<ol><li>GitHub → Settings → Developer settings → <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained tokens</a></li><li>Repository access: only <strong>${esc(r.owner)}/${esc(r.repo)}</strong></li><li>Permissions: <strong>Contents → Read and write</strong></li></ol>
<form data-form="unlock">
<label class="field"><span>Token</span><input name="token" type="password" autocomplete="off" required></label>
<label class="field"><span>Repository</span><input name="repo" value="${esc(`${store.get('owner') ?? r.owner}/${store.get('repo') ?? r.repo}`)}" required></label>
<div class="buttons"><button class="button" type="submit">Unlock</button></div>
</form>
<p class="meta">The token is kept in this browser only and sent only to api.github.com. "Lock" removes it.</p></main>`;
}

/* ---------- actions ---------- */

let toastTimer;
function toast(text, { undo = false, error = false } = {}) {
  state.toast = { text, undo, error };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = null; render(); }, error ? 9000 : 6000);
  render();
}

async function run(action, { done, undoable = true } = {}) {
  if (state.busy) return;
  state.busy = true;
  state.editing = false;
  render();
  try {
    state.data = await state.repo.commit(state.data, action, { validate: validateData });
    if (undoable) state.undo.push(action);
    state.busy = false;
    toast(done ?? 'Saved', { undo: undoable });
  } catch (err) {
    state.busy = false;
    toast(err.message, { error: true });
  }
}

const noteValue = () => app.querySelector('#note')?.value ?? '';

const act = {
  approve: (note = noteValue()) => { const it = current(); if (it) run(approve(state.data, it.id, note), { done: 'Approved · live in about a minute' }); },
  skip: () => { const it = current(); if (it) run(skip(state.data, it.id), { done: 'Skipped' }); },
  'save-note': () => { const it = current(); if (it) run(editNote(state.data, it.id, noteValue()), { done: 'Note saved · live in about a minute' }); },
  unpublish: () => { const it = current(); if (it && confirm(`Unpublish “${it.title}”?`)) run(unpublish(state.data, it.id), { done: 'Unpublished' }); },
  'toggle-writer': () => { const w = current(); if (w) run(setWriterActive(state.data, w.id, !w.active), { done: w.active ? 'Paused' : 'Resumed' }); },
  undo: () => { const last = state.undo.pop(); if (last) run(last.inverse, { done: 'Undone', undoable: false }); },
  link: () => { state.dialog = 'link'; render(); },
  writer: () => { state.dialog = 'writer'; render(); },
  help: () => { state.dialog = 'help'; render(); },
  dismiss: () => { state.dialog = null; state.prefill = null; render(); },
  close: () => { state.open = false; render(); },
  lock: () => { store.del('token'); state.repo = null; state.data = null; render(); },
};

function move(delta) {
  const n = list().length;
  if (!n) return;
  state.sel = Math.max(0, Math.min(n - 1, state.sel + delta));
  state.editing = false;
  render();
}

function setTab(tab) { state.tab = tab; state.sel = 0; state.open = false; state.editing = false; render(); }

/* ---------- events ---------- */

app.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) return setTab(tab.dataset.tab);
  const doer = e.target.closest('[data-do]');
  if (doer && (doer.dataset.do !== 'dismiss' || e.target === doer)) return act[doer.dataset.do]?.();
  const row = e.target.closest('.row[data-i]');
  if (row) { state.sel = Number(row.dataset.i); state.open = true; render(); }
});

app.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const f = Object.fromEntries(new FormData(form));
  try {
    if (form.dataset.form === 'unlock') {
      const [owner, repo] = String(f.repo).trim().split('/');
      store.set('owner', owner); store.set('repo', repo); store.set('token', f.token.trim());
      return start();
    }
    if (form.dataset.form === 'link') { state.dialog = null; const captured = state.prefill?.publishedAt;
      const publishedAt = f.publishedAt ? (captured && captured.startsWith(f.publishedAt) ? captured : `${f.publishedAt}T12:00:00.000Z`) : undefined;
      const action = addLink(state.data, f.url, undefined, { title: f.title, excerpt: f.excerpt, publishedAt, author: f.author, source: f.source, icon: f.icon });
      state.prefill = null;
      return run(action, { done: 'Added · it will be in the queue in a few minutes' }); }
    if (form.dataset.form === 'writer') {
      const action = addWriter(state.data, { name: f.name, country: f.country, links: String(f.links).split(/\s+/) });
      state.dialog = null;
      return run(action, { done: 'Writer added · their latest 3 pieces arrive in the queue shortly' });
    }
  } catch (err) { toast(err.message, { error: true }); }
});

document.addEventListener('keydown', (e) => {
  if (!state.data || e.metaKey || e.ctrlKey || e.altKey) return;
  const inField = e.target.closest?.('input, textarea');
  if (e.key === 'Escape') {
    if (state.dialog) return act.dismiss();
    if (inField) { e.target.blur(); state.editing = false; return; }
    if (state.open) return act.close();
    return;
  }
  if (inField) {
    if (e.target.id === 'note' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      return state.tab === 'queue' ? act.approve() : act['save-note']();
    }
    return;
  }
  if (state.dialog) return;
  const keyMap = {
    j: () => move(1), k: () => move(-1), ArrowDown: () => move(1), ArrowUp: () => move(-1),
    Enter: () => { state.open = true; render(); },
    o: () => { const it = current(); const url = it?.url ?? (it?.links && Object.values(it.links)[0]); if (url) window.open(url, '_blank', 'noopener'); },
    a: () => { if (state.tab === 'queue') { state.editing = true; render(); } },
    A: () => { if (state.tab === 'queue') act.approve(''); },
    s: () => { if (state.tab === 'queue') act.skip(); },
    e: () => { if (state.tab === 'published') { state.editing = true; render(); } },
    x: () => { if (state.tab === 'published') act.unpublish(); },
    p: () => { if (state.tab === 'writers') act['toggle-writer'](); },
    u: act.undo, n: act.link, w: act.writer, '?': act.help,
    1: () => setTab('queue'), 2: () => setTab('writers'), 3: () => setTab('published'),
  };
  const key = e.shiftKey && e.key === 'a' ? 'A' : e.key; // some keyboards/tools report Shift+a as 'a'
  const fn = keyMap[key];
  if (fn) { e.preventDefault(); fn(); }
});

/* ---------- start ---------- */

async function start() {
  const token = store.get('token');
  if (!token) { state.repo = null; return render(); }
  const fallback = defaultRepo();
  // `kems.api` is only ever set by the local dev server (scripts/serve.js) to stand in for GitHub.
  state.repo = createRepo({ owner: store.get('owner') ?? fallback.owner, repo: store.get('repo') ?? fallback.repo, token, ...(store.get('api') ? { api: store.get('api') } : {}) });
  state.data = null;
  render();
  try {
    state.data = await state.repo.load(FILES);
    const added = readAddHash();
    if (added) { state.prefill = added; state.dialog = 'link'; history.replaceState(null, '', location.pathname); }
    render();
  } catch (err) {
    if (/token was rejected/.test(err.message)) store.del('token');
    state.repo = null;
    render();
    toast(err.message, { error: true });
  }
}

start();
