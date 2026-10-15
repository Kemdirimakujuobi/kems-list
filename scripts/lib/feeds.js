// Finding, fetching and reading writers' feeds (RSS 2.0 and Atom), and turning items into queue candidates.
import { XMLParser } from 'fast-xml-parser';
import { canonicalUrl, idFor } from './canonical.js';

export const USER_AGENT = 'KemsList/1.0 (+https://kemdirimakujuobi.github.io/kems-list/)';
const TIMEOUT_MS = 15000;
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_WORDS = 300;
const WORDS_PER_MINUTE = 230;
const EXCERPT_MAX = 280;

/* ---------- fetching ---------- */

export async function fetchText(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) throw new Error('response too large');
  const text = await res.text();
  if (text.length > MAX_BYTES) throw new Error('response too large');
  return text;
}

/* ---------- feed discovery ---------- */

export function feedUrlFor(link) {
  let u;
  try { u = new URL(link); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const first = u.pathname.split('/').filter(Boolean)[0] || '';

  if (host === 'substack.com' && first.startsWith('@')) return `https://${first.slice(1)}.substack.com/feed`;
  if (host.endsWith('.substack.com')) return `https://${host}/feed`;
  if (host === 'medium.com' && first) return first.startsWith('@') ? `https://medium.com/feed/${first}` : `https://medium.com/feed/${first}`;
  if (host.endsWith('.medium.com')) return `https://medium.com/feed/@${host.split('.')[0]}`;
  return null;
}

export async function discoverFeedUrl(link, fetchImpl = fetch) {
  const direct = feedUrlFor(link);
  if (direct) return direct;
  const page = await fetchText(link, fetchImpl);
  for (const tag of page.match(/<link\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    if (/alternate/i.test(a.rel || '') && /application\/(rss|atom)\+xml/i.test(a.type || '') && a.href) {
      try { return new URL(a.href, link).href; } catch { /* ignore bad href */ }
    }
  }
  return null;
}

/* ---------- parsing ---------- */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
  // Atom bodies may be inline XHTML markup; keep them raw and decode per their `type` below.
  stopNodes: ['feed.entry.content', 'feed.entry.summary'],
});

// Raw Atom <content>/<summary> → HTML string, honouring type="xhtml" | "html" | "text" and CDATA.
function atomBody(node) {
  if (node == null) return '';
  const raw = String(typeof node === 'object' ? node['#text'] ?? '' : node).trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  if (cdata) return cdata[1];
  return (typeof node === 'object' && node['@_type'] === 'xhtml') ? raw : decodeEntities(raw);
}

const text = (v) => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v)).trim();
const first = (v) => (Array.isArray(v) ? v[0] : v);
const isoOrNull = (v) => { const t = Date.parse(text(v)); return Number.isNaN(t) ? null : new Date(t).toISOString(); };

export function parseFeed(xml) {
  let doc;
  try { doc = parser.parse(xml); } catch { doc = null; }
  const channel = doc?.rss?.channel ? first(doc.rss.channel) : null;
  const atom = doc?.feed;
  if (!channel && !atom) throw new Error('not an RSS or Atom feed');

  if (channel) {
    const generator = text(channel.generator);
    const isSubstack = /substack/i.test(generator) || /substackcdn\.com/.test(JSON.stringify(channel.image ?? ''));
    const items = (channel.item || []).map((it) => ({
      url: text(first(it.link)) || (/^https?:/.test(text(it.guid)) ? text(it.guid) : ''),
      title: textOf(text(it.title)),
      publishedAt: isoOrNull(it.pubDate ?? it['dc:date']),
      description: textOf(text(it.description)),
      html: text(it['content:encoded']),
      enclosureType: it.enclosure?.['@_type'] || null,
    }));
    return { title: textOf(text(channel.title)), generator, isSubstack, items };
  }

  const entries = (atom.entry || []).map((e) => {
    const links = e.link || [];
    const alt = links.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
    const enclosure = links.find((l) => l['@_rel'] === 'enclosure');
    return {
      url: alt?.['@_href'] || (/^https?:\/\//.test(text(e.id)) ? text(e.id) : ''),
      title: textOf(text(e.title)),
      publishedAt: isoOrNull(e.published ?? e.updated),
      description: textOf(atomBody(e.summary)),
      html: atomBody(e.content),
      enclosureType: enclosure?.['@_type'] || null,
    };
  });
  return { title: textOf(text(atom.title)), generator: text(atom.generator), isSubstack: false, items: entries };
}

/* ---------- text helpers ---------- */

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', mdash: '—', ndash: '–', hellip: '…', copy: '©' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const BLOCK = /<\/?(p|div|br|li|ul|ol|h[1-6]|blockquote|figure|figcaption|tr|td|th|section|article|pre|hr)\b[^>]*>/gi;

export function textOf(html) {
  return decodeEntities(String(html ?? '')
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(BLOCK, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

const wordCount = (t) => (t ? t.split(/\s+/).length : 0);

export function excerptOf(t) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= EXCERPT_MAX) return s;
  const slice = s.slice(0, EXCERPT_MAX);
  let cut = -1;
  for (const m of slice.matchAll(/[.!?…]["”’)]?(?=\s)/g)) if (m.index >= 120) cut = m.index + m[0].length;
  if (cut > 0) return slice.slice(0, cut);
  const space = slice.lastIndexOf(' ', EXCERPT_MAX - 1);
  return `${slice.slice(0, space > 0 ? space : EXCERPT_MAX - 1).replace(/[\s,;:–—-]+$/, '')}…`;
}

export function readMinutes(html) {
  return Math.max(1, Math.round(wordCount(textOf(html)) / WORDS_PER_MINUTE));
}

export function platformOf(url, feed = {}) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (host.endsWith('substack.com') || feed.isSubstack) return 'Substack';
  if (host === 'medium.com' || host.endsWith('.medium.com')) return 'Medium';
  return host;
}

// The opening prose of an article: body paragraphs only, skipping figures, captions and one-line bylines.
function leadText(html) {
  if (!html) return '';
  const body = html.replace(/<(figure|figcaption|picture|svg|table|pre)\b[\s\S]*?<\/\1>/gi, ' ');
  const paragraphs = [...body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => textOf(m[1])).filter((p) => p.length >= 40);
  return paragraphs.join(' ') || textOf(body);
}

const TEASER = /\[(…|\.\.\.)\]|continue reading|read more\b|appeared first on/i;
const PAYWALL = /class="[^"]*paywall|for paid subscribers|continue reading on medium|member-only story/i;

/* ---------- candidates ---------- */

export function toCandidate(item, { writerId, now = new Date(), feed = {} }) {
  if (!item?.url || !item.title) return null;
  if (/^(audio|video)\//i.test(item.enclosureType || '')) return null;
  const url = canonicalUrl(item.url);
  if (!url) return null;

  const paywalled = PAYWALL.test(item.html || '');
  const bodyText = item.html ? textOf(item.html) : '';
  // Only trust the length when the feed carries the actual text, not nothing or a teaser.
  const words = bodyText && !TEASER.test(bodyText) ? wordCount(bodyText) : null;
  if (!paywalled && words !== null && words < MIN_WORDS) return null;

  const source = item.description && item.description.length >= 40 ? item.description : leadText(item.html) || item.description;
  const candidate = {
    id: idFor(url),
    url,
    title: item.title,
    ...(writerId ? { writerId } : {}),
    publishedAt: item.publishedAt ?? now.toISOString(),
    excerpt: excerptOf(source),
    platform: platformOf(url, feed),
    paywalled,
    foundAt: now.toISOString(),
  };
  if (!paywalled && words !== null && words >= MIN_WORDS) candidate.readMinutes = Math.max(1, Math.round(words / WORDS_PER_MINUTE));
  if (!candidate.excerpt) delete candidate.excerpt;
  return candidate;
}

/* ---------- single pages (inbox links) ---------- */

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return out;
}

export function pageMeta(html) {
  const metas = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    const key = (a.property || a.name || '').toLowerCase();
    if (key && a.content && !(key in metas)) metas[key] = a.content.trim();
  }
  let canonical = null;
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const a = attrs(tag);
    if (/(^|\s)canonical(\s|$)/i.test(a.rel || '') && a.href) { canonical = a.href; break; }
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const author = metas.author || (metas['article:author'] && !/^https?:/.test(metas['article:author']) ? metas['article:author'] : null);
  return {
    title: textOf(metas['og:title'] || metas['twitter:title'] || titleTag || '') || null,
    description: textOf(metas['og:description'] || metas.description || metas['twitter:description'] || '') || null,
    publishedAt: isoOrNull(metas['article:published_time'] || metas['og:published_time'] || ''),
    author: author || null,
    canonical,
  };
}
