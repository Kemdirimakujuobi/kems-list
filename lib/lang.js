// Guesses a piece's language from its title and excerpt: English, French or Portuguese. Runs in Node
// (build) and the browser (desk), so: no imports. Counts common function words plus a few spellings only
// one language uses; anything short or unclear counts as English, so it never tags an English piece.

const WORDS = {
  en: 'the and of to is in that it for with was on are as this be by not you at from have but they his her we what how why who when there was a',
  fr: 'le la les des du et est une un qui dans pour pas sur au aux ce cette sont avec par nous je il elle mais ou leur ne en après',
  pt: 'o os as da do das dos é um uma em no na nos nas com para não por mais como ao à pelo pela ser foi há vez sua seu nossa',
};
const SHARED = 'de que se a e'; // French and Portuguese both use these; they count for both
const SPELLINGS = {
  fr: /[èùœ]|\b[ldjnsc]['’][a-zà-ÿ]|\bqu['’]/,
  pt: /[ãõ]|ção\b|ções\b/,
};

const sets = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(' '))]));
const shared = new Set(SHARED.split(' '));

export const LANGUAGE_NAMES = { en: 'English', fr: 'French', pt: 'Portuguese' };

export function languageOf(text) {
  const s = String(text ?? '').normalize('NFKC').toLowerCase();
  const score = { en: 0, fr: 0, pt: 0 };
  for (const w of s.match(/[a-zà-ÿœ'’]+/g) || []) { // apostrophes stay inside words: O'Keeffe is not « o »
    for (const k in sets) if (sets[k].has(w)) score[k] += 1;
    if (shared.has(w)) { score.fr += 0.5; score.pt += 0.5; }
  }
  for (const k in SPELLINGS) if (SPELLINGS[k].test(s)) score[k] += 2;
  if (/\S\s[:;?!»]/.test(s)) score.fr += 1.5; // French typography: a space before « : ; ? ! »
  const [best] = ['fr', 'pt'].sort((a, b) => score[b] - score[a]);
  return score[best] >= 2 && score[best] > score.en ? best : 'en';
}
