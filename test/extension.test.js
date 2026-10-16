import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { deskUrl, originPattern } from '../extension/shared.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('manifest is MV3 with only the narrow permissions it needs', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting']);
  assert.equal(m.host_permissions, undefined, 'no standing access to any site');
  assert.deepEqual(m.optional_host_permissions, ['https://*/*', 'http://*/*']);
  assert.equal(m.background.service_worker, 'background.js');
  assert.equal(m.background.type, 'module');
  assert.ok(m.commands['add-to-kems-list'].suggested_key.default);
  for (const size of ['16', '32', '48', '128']) assert.ok(existsSync(new URL(`../extension/${m.icons[size]}`, import.meta.url)), size);
});

test("the extension ships the exact same page reader as the site", () => {
  assert.equal(read('extension/capture.js'), read('lib/capture.js'), 'run: npm run extension:sync');
});

test('deskUrl puts the captured details after #, so they never reach a server', () => {
  const m = { url: 'https://x.substack.com/p/a', title: 'A “title” & more' };
  const url = deskUrl(m);
  assert.ok(url.startsWith('https://kemdirimakujuobi.github.io/kems-list/desk/#add='));
  assert.deepEqual(JSON.parse(decodeURIComponent(url.split('#add=')[1])), m);
});

test('originPattern asks for one site at a time', () => {
  assert.equal(originPattern('https://deesknees1.substack.com/p/i-want-love?utm=x'), 'https://deesknees1.substack.com/*');
  assert.equal(originPattern('javascript:alert(1)'), null);
});
