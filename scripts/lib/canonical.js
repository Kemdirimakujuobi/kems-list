// One URL → one id, so a piece can never be queued or published twice.
import { createHash } from 'node:crypto';

import { canonicalUrl } from '../../lib/url.js';

export { canonicalUrl };

export function idFor(url) {
  const canonical = canonicalUrl(url);
  if (!canonical) throw new Error(`idFor: not an http(s) URL: ${url}`);
  // http and https are the same piece (Blogspot pages link http, their feeds https). No stored URL is
  // http today, so upgrading before hashing leaves every existing id unchanged.
  return createHash('sha1').update(canonical.replace(/^http:/, 'https:')).digest('hex').slice(0, 12);
}
