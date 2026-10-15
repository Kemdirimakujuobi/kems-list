// URL normalisation shared by Node scripts and the browser desk (no imports).
const TRACKING = /^(utm_.*|ref|ref_src|source|s|r|fbclid|gclid|mc_cid|mc_eid|triedRedirect)$/i;

export function canonicalUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
  const search = u.searchParams.toString();
  let path = u.pathname;
  if (path !== '/') path = path.replace(/\/+$/, '');
  else if (!search) path = '';
  return `${u.protocol}//${u.host.toLowerCase()}${path}${search ? `?${search}` : ''}`;
}
