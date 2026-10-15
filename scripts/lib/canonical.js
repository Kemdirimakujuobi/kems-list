// One URL → one id, so a piece can never be queued or published twice.
import { createHash } from 'node:crypto';

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

export function idFor(url) {
  const canonical = canonicalUrl(url);
  if (!canonical) throw new Error(`idFor: not an http(s) URL: ${url}`);
  return createHash('sha1').update(canonical).digest('hex').slice(0, 12);
}
