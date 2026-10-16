// Kem's List extension: read the piece you're on, open the desk with everything filled in.
// No tokens, no standing site access: `activeTab` covers the tab you clicked; adding a *link* asks for that one
// site the first time. Saving always happens in the desk.
import { capturePage } from './capture.js';
import { deskUrl, originPattern } from './shared.js';

const LOAD_TIMEOUT_MS = 20000;

// Runs the shared page reader inside the tab (with no arguments it reads that page's document and location).
async function capture(tabId) {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func: capturePage });
  if (!frame?.result?.url) throw new Error('Nothing readable on this page.');
  return frame.result;
}

async function openDesk(details, nextToTab) {
  await chrome.tabs.create({ url: deskUrl(details), ...(nextToTab ? { index: nextToTab.index + 1 } : {}) });
}

// A short badge on the toolbar icon when something goes wrong (e.g. chrome:// pages can't be read).
async function flash(text) {
  await chrome.action.setBadgeBackgroundColor({ color: '#c0352b' });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
}

async function addPage(tab) {
  try {
    await openDesk(await capture(tab.id), tab);
  } catch (err) {
    console.warn("Kem's List:", err.message);
    await flash('!');
  }
}

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('Page took too long to load.')); }, LOAD_TIMEOUT_MS);
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Right-click on a link: open it quietly, read it, close it, then open the desk.
// Needs permission for that one site, asked the first time (must be requested straight from the click).
async function addLink(linkUrl, fromTab) {
  const origin = originPattern(linkUrl);
  if (!origin) return flash('!');
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [origin] }); } catch { granted = false; }
  if (!granted) {
    // Without permission, open the article so you can press the toolbar button there.
    await chrome.tabs.create({ url: linkUrl, index: fromTab.index + 1 });
    return;
  }
  const tab = await chrome.tabs.create({ url: linkUrl, active: false, index: fromTab.index + 1 });
  try {
    await waitForLoad(tab.id);
    const details = await capture(tab.id);
    await chrome.tabs.remove(tab.id);
    await openDesk(details, fromTab);
  } catch (err) {
    console.warn("Kem's List:", err.message);
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    await flash('!');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'kems-page', title: "Add this page to Kem's List", contexts: ['page'] });
    chrome.contextMenus.create({ id: 'kems-link', title: "Add this link to Kem's List", contexts: ['link'] });
  });
});

chrome.action.onClicked.addListener((tab) => addPage(tab));

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'add-to-kems-list' && tab) addPage(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'kems-page') addPage(tab);
  if (info.menuItemId === 'kems-link' && info.linkUrl) addLink(info.linkUrl, tab);
});
