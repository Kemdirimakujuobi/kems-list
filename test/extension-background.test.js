import test from 'node:test';
import assert from 'node:assert/strict';

// A minimal fake of the chrome.* APIs the service worker uses, recording what it does.
function fakeChrome({ captureResult = { url: 'https://x.substack.com/p/a', title: 'A' }, grant = true, captureThrows = false } = {}) {
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { (listeners[name] ??= []).push(fn); }, removeListener: (fn) => { listeners[name] = (listeners[name] || []).filter((f) => f !== fn); } });
  const log = { created: [], removed: [], badges: [], scripted: [], permissionAsks: [], menus: [] };
  let nextId = 100;
  const chrome = {
    runtime: { onInstalled: on('installed') },
    action: { onClicked: on('action'), setBadgeText: async ({ text }) => log.badges.push(text), setBadgeBackgroundColor: async () => {} },
    commands: { onCommand: on('command') },
    contextMenus: { onClicked: on('menu'), removeAll: (cb) => cb(), create: (m) => log.menus.push(m.id) },
    permissions: { request: async ({ origins }) => { log.permissionAsks.push(origins[0]); return grant; } },
    scripting: {
      executeScript: async ({ target, func }) => {
        log.scripted.push({ tabId: target.tabId, func: func.name });
        if (captureThrows) throw new Error('Cannot access a chrome:// URL');
        return [{ result: captureResult }];
      },
    },
    tabs: {
      onUpdated: on('updated'),
      create: async (opts) => {
        const tab = { id: nextId++, index: (opts.index ?? 0), ...opts };
        log.created.push(tab);
        if (opts.active === false) setTimeout(() => (listeners.updated || []).forEach((fn) => fn(tab.id, { status: 'complete' })), 0);
        return tab;
      },
      remove: async (id) => log.removed.push(id),
      update: async () => {},
    },
  };
  return { chrome, listeners, log };
}

async function load(options) {
  const fake = fakeChrome(options);
  globalThis.chrome = fake.chrome;
  await import(`../extension/background.js?t=${Math.random()}`);
  fake.listeners.installed?.forEach((fn) => fn());
  return fake;
}
const settle = () => new Promise((r) => setTimeout(r, 20));
const desk = (tab) => decodeURIComponent(tab.url.split('#add=')[1] ?? '');

test('toolbar click reads the page with the shared reader and opens the desk next to it', async () => {
  const { listeners, log } = await load();
  listeners.action[0]({ id: 7, index: 3 });
  await settle();
  assert.deepEqual(log.scripted, [{ tabId: 7, func: 'capturePage' }]);
  assert.equal(log.created.length, 1);
  assert.equal(log.created[0].index, 4);
  assert.deepEqual(JSON.parse(desk(log.created[0])), { url: 'https://x.substack.com/p/a', title: 'A' });
  assert.deepEqual(log.menus, ['kems-page', 'kems-link']);
});

test('keyboard shortcut and page menu do the same', async () => {
  const { listeners, log } = await load();
  listeners.command[0]('add-to-kems-list', { id: 8, index: 0 });
  listeners.menu[0]({ menuItemId: 'kems-page' }, { id: 9, index: 1 });
  await settle();
  assert.deepEqual(log.scripted.map((s) => s.tabId), [8, 9]);
  assert.equal(log.created.length, 2);
});

test('unreadable pages (e.g. chrome://) show a badge instead of opening an empty desk', async () => {
  const { listeners, log } = await load({ captureThrows: true });
  listeners.action[0]({ id: 7, index: 0 });
  await settle();
  assert.equal(log.created.length, 0);
  assert.deepEqual(log.badges, ['!']);
});

test('link menu: asks for that one site, reads it in a background tab, closes it, opens the desk', async () => {
  const { listeners, log } = await load({ captureResult: { url: 'https://deesknees1.substack.com/p/i-want-love', title: 'I Want Love' } });
  listeners.menu[0]({ menuItemId: 'kems-link', linkUrl: 'https://substack.com/home/post/p-203478911' }, { id: 1, index: 0 });
  await settle();
  assert.deepEqual(log.permissionAsks, ['https://substack.com/*']);
  const [background, deskTab] = log.created;
  assert.equal(background.active, false);
  assert.deepEqual(log.removed, [background.id]);
  assert.equal(JSON.parse(desk(deskTab)).url, 'https://deesknees1.substack.com/p/i-want-love', 'redirected app link resolves to the real post');
});

test('link menu without permission just opens the article for a toolbar click there', async () => {
  const { listeners, log } = await load({ grant: false });
  listeners.menu[0]({ menuItemId: 'kems-link', linkUrl: 'https://x.substack.com/p/a' }, { id: 1, index: 0 });
  await settle();
  assert.equal(log.created.length, 1);
  assert.equal(log.created[0].url, 'https://x.substack.com/p/a');
  assert.equal(log.scripted.length, 0);
});
