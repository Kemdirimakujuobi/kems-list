// Reads a piece's details from the page you're reading. Runs inside the "Add to Kem's List" bookmarklet,
// so it must stay ONE self-contained function: no imports, no outside helpers (the desk serialises it with
// capturePage.toString()). Order of trust: JSON-LD → Open Graph / meta tags → the URL itself.
export function capturePage(doc, href) {
  const abs = (u) => { try { return new URL(u, href).href; } catch { return null; } };
  const iso = (v) => { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString(); };
  const meta = (...names) => {
    for (const n of names) {
      const el = doc.querySelector(`meta[property="${n}"]`) || doc.querySelector(`meta[name="${n}"]`);
      const v = el && el.getAttribute('content');
      if (v && v.trim()) return v.trim();
    }
    return null;
  };
  const imageUrl = (img) => (typeof img === 'string' ? img : img && (img.url || img.contentUrl)) || null;
  const generic = (u) => !u || /substackcdn\.com\/icons\/substack\//.test(u);

  // JSON-LD: the first Article-like object, looking inside arrays and @graph
  let article = null;
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try { data = JSON.parse(s.textContent); } catch { continue; }
    const items = [].concat(data).flatMap((d) => (d && d['@graph'] ? d['@graph'] : [d]));
    article = items.find((d) => d && (d.headline || /Article|BlogPosting/.test(String(d['@type'])))) || article;
    if (article) break;
  }
  const ld = article || {};
  const ldAuthor = [].concat(ld.author || [])[0] || null;
  const publisher = ld.publisher || null;

  const url = new URL(abs((doc.querySelector('link[rel="canonical"]') || {}).href || '') || href);
  url.hash = '';
  for (const k of [...url.searchParams.keys()]) if (/^utm_|^(ref|source|s|r)$/i.test(k)) url.searchParams.delete(k);

  const linkHref = (sel) => { const el = doc.querySelector(sel); return el ? abs(el.getAttribute('href')) : null; };
  const icons = [
    imageUrl(publisher && publisher.logo),
    linkHref('link[rel="apple-touch-icon"]'),
    linkHref('link[rel~="icon"]'),
    imageUrl(ldAuthor && ldAuthor.image),
  ].filter((u) => u && !generic(u));

  const out = {
    url: url.href.replace(/\?$/, ''),
    title: ld.headline || meta('og:title', 'twitter:title') || (doc.title || '').trim() || null,
    excerpt: ld.description || meta('og:description', 'description', 'twitter:description'),
    publishedAt: iso(ld.datePublished || meta('article:published_time') || ''),
    author: (ldAuthor && ldAuthor.name) || meta('author'),
    source: (publisher && publisher.name) || meta('og:site_name') || url.hostname.replace(/^www\./, ''),
    icon: icons[0] || null,
  };
  for (const k of Object.keys(out)) if (out[k] == null || out[k] === '') delete out[k];
  return out;
}
