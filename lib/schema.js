// Shape checks for data/*.json. Runs in Node (build) and the browser (desk), so: no imports.

const isStr = (v) => typeof v === 'string' && v.trim() !== '';
const isUrl = (v) => isStr(v) && /^https?:\/\/[^\s]+$/i.test(v);
const isDate = (v) => isStr(v) && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
const isId = (v) => typeof v === 'string' && /^[0-9a-f]{12}$/.test(v);
const isSlug = (v) => typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v);

function checkList(errors, name, list, fields, { idKey } = {}) {
  if (!Array.isArray(list)) { errors.push(`${name}: must be an array`); return; }
  const seen = new Set();
  list.forEach((item, i) => {
    const at = `${name}[${i}]`;
    if (!item || typeof item !== 'object') { errors.push(`${at}: must be an object`); return; }
    for (const [key, rule, optional] of fields) {
      const v = item[key];
      if (v === undefined || v === null || v === '') { if (!optional) errors.push(`${at}.${key}: ${rule.missing}`); continue; }
      if (!rule.test(v)) errors.push(`${at}.${key}: ${rule.message}`);
    }
    if (idKey && item[idKey] !== undefined) {
      if (seen.has(item[idKey])) errors.push(`${at}.${idKey}: duplicate id ${item[idKey]}`);
      seen.add(item[idKey]);
    }
  });
}

const R = {
  str: { test: isStr, message: 'must be a non-empty string', missing: 'required string' },
  url: { test: isUrl, message: 'must be an http(s) URL', missing: 'required URL' },
  date: { test: isDate, message: 'must be an ISO date', missing: 'required date' },
  id: { test: isId, message: 'must be a 12-char hex id', missing: 'required id' },
  slug: { test: isSlug, message: 'must be a lowercase slug', missing: 'required slug' },
  bool: { test: (v) => typeof v === 'boolean', message: 'must be true or false', missing: 'required boolean' },
  lang: { test: (v) => typeof v === 'string' && /^[a-z]{2}$/.test(v), message: 'must be a two-letter language code like fr', missing: 'required language' },
  minutes: { test: (v) => Number.isInteger(v) && v > 0, message: 'must be a positive integer', missing: 'required number' },
  links: {
    test: (v) => typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0 && Object.values(v).every(isUrl),
    message: 'must map platform → http(s) URL', missing: 'required links',
  },
};

const PIECE_FIELDS = [
  ['id', R.id], ['url', R.url], ['title', R.str], ['publishedAt', R.date], ['excerpt', R.str, true],
  ['platform', R.str], ['readMinutes', R.minutes, true],
  ['source', R.str, true], ['author', R.str, true], ['icon', R.url, true], ['lang', R.lang, true],
];

export function validateData({ writers, inbox, pieces, skipped, queue, status }) {
  const errors = [];
  checkList(errors, 'writers', writers, [
    ['id', R.slug], ['name', R.str], ['country', R.str, true], ['links', R.links], ['active', R.bool], ['addedAt', R.date], ['icon', R.url, true],
  ], { idKey: 'id' });
  checkList(errors, 'inbox', inbox, [
    ['url', R.url], ['addedAt', R.date], ['title', R.str, true], ['excerpt', R.str, true],
    ['publishedAt', R.date, true], ['author', R.str, true], ['source', R.str, true], ['icon', R.url, true],
  ]);
  checkList(errors, 'pieces', pieces, [...PIECE_FIELDS, ['writerId', R.slug, true], ['approvedAt', R.date], ['note', R.str, true]], { idKey: 'id' });
  checkList(errors, 'queue', queue, [...PIECE_FIELDS, ['writerId', R.slug, true], ['paywalled', R.bool], ['foundAt', R.date]], { idKey: 'id' });

  if (!Array.isArray(skipped)) errors.push('skipped: must be an array');
  else skipped.forEach((v, i) => { if (!isId(v)) errors.push(`skipped[${i}]: must be a 12-char hex id`); });

  if (!status || typeof status !== 'object' || typeof status.feeds !== 'object' || !Array.isArray(status.deadLinks)) {
    errors.push('status: must have feeds {} and deadLinks []');
  }

  if (Array.isArray(writers) && Array.isArray(pieces)) {
    const known = new Set(writers.map((w) => w.id));
    pieces.forEach((p, i) => { if (p?.writerId && !known.has(p.writerId)) errors.push(`pieces[${i}].writerId: unknown writer ${p.writerId}`); });
  }
  return errors;
}
